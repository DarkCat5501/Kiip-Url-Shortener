import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { LinksService } from '../links/links.service.js';
import { ACCESS_LOG_BUFFER_KEY, REDIS_CLICK_COUNT_KEY } from '../_core/constants.js';

export enum RedirectStatus {
  OK = 'ok',
  GONE = 'gone',
}

type RedirectResult = {
  url: string;
  status: RedirectStatus;
};

type AccessLogEntry = {
  slug: string;
  referer?: string;
  userAgent?: string;
  ip?: string;
};

@Injectable()
export class RedirectService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedirectService.name);
  private flushInterval: NodeJS.Timeout | null = null;
  private redisFlushInterval: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private pendingLogs: string[] = [];
  private pendingClicks = new Map<string, number>();

  private readonly accessLogThreshold: number;
  private readonly accessLogFlushIntervalMs: number;
  private readonly accessLogFlushBatchSize: number;
  private readonly clickCountTtlSeconds: number;
  private readonly redisPushIntervalMs: number;
  private readonly redisPushMaxBatch: number;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private linksService: LinksService,
    private config: ConfigService,
  ) {
    this.accessLogThreshold = this.config.get<number>('ACCESS_LOG_THRESHOLD', 100);
    this.accessLogFlushIntervalMs = this.config.get<number>('ACCESS_LOG_FLUSH_INTERVAL_MS', 5000);
    this.accessLogFlushBatchSize = this.config.get<number>('ACCESS_LOG_FLUSH_BATCH_SIZE', 1000);
    this.clickCountTtlSeconds = this.config.get<number>('CLICK_COUNT_TTL_SECONDS', 3600);
    this.redisPushIntervalMs = this.config.get<number>('ACCESS_REDIS_PUSH_INTERVAL_MS', 100);
    this.redisPushMaxBatch = this.config.get<number>('ACCESS_REDIS_PUSH_MAX_BATCH', 500);
  }

  async onModuleInit() {
    await this.flushLogs();

    // Exige CPU always-allocated no Cloud Run (ver README "Cloud Run"),
    // senão o timer fica suspenso entre requests.
    this.flushInterval = setInterval(() => {
      this.flushLogs().catch((err) => this.logger.error('Failed to flush logs', err));
    }, this.accessLogFlushIntervalMs);

    this.redisFlushInterval = setInterval(() => {
      this.pushPendingToRedis().catch((err) => this.logger.error('Failed to push accesses to Redis', err));
    }, this.redisPushIntervalMs);
  }

  async onModuleDestroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    if (this.redisFlushInterval) {
      clearInterval(this.redisFlushInterval);
    }
    await this.pushPendingToRedis().catch((err) => this.logger.error('Failed final push to Redis', err));
    await this.flushLogs().catch((err) => this.logger.error('Failed final flush on shutdown', err));
  }

  private async flushLogs() {
    if (this.isFlushing) return;

    try {
      this.isFlushing = true;

      let logs = await this.redis.lpopall<AccessLogEntry>(ACCESS_LOG_BUFFER_KEY, this.accessLogFlushBatchSize);

      while (logs.length > 0) {
        await this.flushBatch(logs);

        if (logs.length < this.accessLogFlushBatchSize) break;

        logs = await this.redis.lpopall(ACCESS_LOG_BUFFER_KEY, this.accessLogFlushBatchSize);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async flushBatch(logs: AccessLogEntry[]) {
    const slugs = Array.from(new Set(logs.map((log) => log.slug)));
    const links = await this.prisma.link.findMany({
      where: { slug: { in: slugs } },
      select: { id: true, slug: true },
    });
    const idBySlug = new Map(links.map((l) => [l.slug, l.id]));

    const resolvedLogs = logs
      .map((log) => {
        const linkId = idBySlug.get(log.slug);
        if (linkId === undefined) return null;
        return { linkId, referer: log.referer, userAgent: log.userAgent, ip: log.ip };
      })
      .filter((log): log is NonNullable<typeof log> => log !== null);

    const unresolvedLogs = logs.filter((log) => !idBySlug.has(log.slug));

    try {
      if (resolvedLogs.length > 0) {
        await this.prisma.accessLog.createMany({ data: resolvedLogs });
      }
    } catch (err) {
      this.logger.warn(`Failed to flush ${resolvedLogs.length} access logs (will retry)`);
      await this.redis.lpush(ACCESS_LOG_BUFFER_KEY, logs.map((log) => JSON.stringify(log)));
      return;
    }

    if (unresolvedLogs.length > 0) {
      this.logger.warn(`${unresolvedLogs.length} access logs waiting for their link to persist (will retry)`);
      await this.redis.lpush(ACCESS_LOG_BUFFER_KEY, unresolvedLogs.map((log) => JSON.stringify(log)));
    }

    await this.flushClickCounts(logs.map((log) => log.slug));
  }

  private async flushClickCounts(slugs: string[]) {
    const deltaBySlug = new Map<string, number>();
    slugs.forEach((slug) => deltaBySlug.set(slug, (deltaBySlug.get(slug) ?? 0) + 1));

    const entries = Array.from(deltaBySlug.entries());

    try {
      await this.prisma.$executeRaw`
        UPDATE "links" AS l
        SET "click_count" = l."click_count" + d.delta
        FROM (
          SELECT * FROM UNNEST(
            ${entries.map(([slug]) => slug)}::text[],
            ${entries.map(([, delta]) => delta)}::int[]
          ) AS t(slug, delta)
        ) AS d
        WHERE l."slug" = d.slug
      `;

      for (const [slug, delta] of entries) {
        await this.redis.incrby(REDIS_CLICK_COUNT_KEY(slug), -delta);
      }
    } catch (err) {
      this.logger.warn(`Failed to sync click counts for ${entries.length} links (will retry)`);
    }
  }

  async processRedirect(
    slug: string,
    res: Response,
  ): Promise<RedirectResult | null> {
    const link = await this.linksService.findBySlug(slug);

    if (!link) {
      return null;
    }

    if (!link.active) {
      return { url: '', status: RedirectStatus.GONE };
    }

    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      this.linksService.invalidate(slug).catch(() => { });
      this.deactivateInBackground(slug);
      return { url: '', status: RedirectStatus.GONE };
    }

    if (link.maxClicks) {
      const [persistedCount, pendingDelta] = await Promise.all([
        this.linksService.getPersistedClickCount(slug),
        this.redis.getCounter(REDIS_CLICK_COUNT_KEY(slug)),
      ]);
      const clickCount = persistedCount + pendingDelta;
      if (clickCount > link.maxClicks) {
        this.linksService.invalidate(slug).catch(() => { });
        this.deactivateInBackground(slug);
        return { url: '', status: RedirectStatus.GONE };
      }
    }

    this.recordAccess(slug, res.req.headers.referer, res.req.headers['user-agent'], res.req.ip);

    return { url: link.url, status: RedirectStatus.OK };
  }

  private recordAccess(
    slug: string,
    referer?: string,
    userAgent?: string | string[],
    ip?: string,
  ): void {
    const log: AccessLogEntry = {
      slug,
      referer: referer || undefined,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      ip,
    };

    this.pendingLogs.push(JSON.stringify(log));
    this.pendingClicks.set(slug, (this.pendingClicks.get(slug) ?? 0) + 1);

    if (this.pendingLogs.length >= this.redisPushMaxBatch) {
      this.pushPendingToRedis().catch((err) => this.logger.error('Failed to push accesses to Redis', err));
    }
  }

  private deactivateInBackground(slug: string): void {
    this.prisma.link
      .update({ where: { slug }, data: { active: false } })
      .catch((err) => this.logger.warn(`Failed to persist deactivation for '${slug}' (will retry on next hit)`));
  }

  // Um round-trip por lote (não por click). Se falhar, devolve o lote ao buffer
  // em memória para a próxima tentativa.
  private async pushPendingToRedis(): Promise<void> {
    if (this.pendingLogs.length === 0) return;

    const logs = this.pendingLogs;
    const clicks = this.pendingClicks;
    this.pendingLogs = [];
    this.pendingClicks = new Map();

    try {
      const bufferLen = await this.redis.pushBatch(
        ACCESS_LOG_BUFFER_KEY,
        logs,
        new Map([...clicks].map(([slug, delta]) => [REDIS_CLICK_COUNT_KEY(slug), delta])),
        this.clickCountTtlSeconds,
      );

      if (bufferLen >= this.accessLogThreshold) {
        this.flushLogs().catch((err) => this.logger.error('Failed to flush logs', err));
      }
    } catch (err) {
      this.pendingLogs.unshift(...logs);
      for (const [slug, delta] of clicks) {
        this.pendingClicks.set(slug, (this.pendingClicks.get(slug) ?? 0) + delta);
      }
      throw err;
    }
  }
}
