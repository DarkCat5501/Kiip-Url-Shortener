import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { LinksService } from '../links/links.service.js';

const REDIS_CLICK_ID = (id: string) => `c:${id}`;
const REDIS_LINK_ID = (id: string) => `l:${id}`;
const ACCESS_LOG_BUFFER_KEY = 'b:acc_logs';

export enum RedirectStatus {
  OK = 'ok',
  GONE = 'gone',
}

type RedirectResult = {
  url: string;
  status: RedirectStatus;
};

type AccessLogEntry = {
  linkId: string;
  referer?: string;
  userAgent?: string;
  ip?: string;
};

@Injectable()
export class RedirectService implements OnModuleInit {
  private readonly logger = new Logger(RedirectService.name);
  private flushInterval: NodeJS.Timeout | null = null;
  private isFlushing = false;

  private readonly accessLogThreshold: number;
  private readonly accessLogFlushIntervalMs: number;
  private readonly accessLogFlushBatchSize: number;
  private readonly clickCountTtlSeconds: number;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private linksService: LinksService,
    private config: ConfigService,
  ) {
    // Quantidade de logs no buffer que dispara um flush imediato (além do timer periódico)
    this.accessLogThreshold = this.config.get<number>('ACCESS_LOG_THRESHOLD', 100);
    // Intervalo do flush periódico do buffer de access logs, em milissegundos
    this.accessLogFlushIntervalMs = this.config.get<number>('ACCESS_LOG_FLUSH_INTERVAL_MS', 5000);
    // Tamanho máximo de cada lote lido do buffer por vez durante o flush
    this.accessLogFlushBatchSize = this.config.get<number>('ACCESS_LOG_FLUSH_BATCH_SIZE', 1000);
    // TTL do contador de cliques pendente no Redis (clicks:{linkId}), em segundos
    this.clickCountTtlSeconds = this.config.get<number>('CLICK_COUNT_TTL_SECONDS', 3600);
  }

  async onModuleInit() {
    await this.flushLogs();

    this.flushInterval = setInterval(() => {
      this.flushLogs().catch((err) => this.logger.error('Failed to flush logs', err));
    }, this.accessLogFlushIntervalMs);
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
    try {
      await this.prisma.accessLog.createMany({ data: logs });
    } catch (err) {
      this.logger.warn(`Failed to flush ${logs.length} access logs (will retry)`);
      await this.redis.lpush(ACCESS_LOG_BUFFER_KEY, logs.map((log) => JSON.stringify(log)));
    }

    await this.flushClickCounts(logs.map((log) => log.linkId));
  }

  private async flushClickCounts(linkIds: string[]) {
    const deltaByLink = new Map<string, number>();
    linkIds.forEach((id) => deltaByLink.set(id, (deltaByLink.get(id) ?? 0) + 1))

    const entries = Array.from(deltaByLink.entries());

    try {
      // Um único UPDATE para todos os links do batch
      await this.prisma.$executeRaw`
        UPDATE "links" AS l
        SET "click_count" = l."click_count" + d.delta
        FROM (
          SELECT * FROM UNNEST(
            ${entries.map(([id]) => id)}::uuid[],
            ${entries.map(([, delta]) => delta)}::int[]
          ) AS t(id, delta)
        ) AS d
        WHERE l."id" = d.id
      `;

      // Deltas já persistidos: remove do baseline pendente para não contar em dobro
      for (const [linkId, delta] of entries) {
        await this.redis.incrby(REDIS_CLICK_ID(linkId), -delta);
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
      this.redis.del(REDIS_LINK_ID(slug)).catch(() => { });
      this.deactivateInBackground(slug);
      return { url: '', status: RedirectStatus.GONE };
    }

    if (link.maxClicks) {
      const [persistedCount, pendingDelta] = await Promise.all([
        this.linksService.getPersistedClickCount(link.id),
        this.redis.getCounter(REDIS_CLICK_ID(link.id)),
      ]);
      const clickCount = persistedCount + pendingDelta;
      if (clickCount > link.maxClicks) {
        this.redis.del(REDIS_LINK_ID(slug)).catch(() => { });
        this.deactivateInBackground(slug);
        return { url: '', status: RedirectStatus.GONE };
      }
    }

    this.recordAccessInBackground(link.id, res.req.headers.referer, res.req.headers['user-agent'], res.req.ip);

    return { url: link.url, status: RedirectStatus.OK };
  }

  private recordAccessInBackground(
    linkId: string,
    referer?: string,
    userAgent?: string | string[],
    ip?: string,
  ): void {
    Promise.all([
      this.logAccessAsync(linkId, referer, userAgent, ip),
      this.incrementClickCount(linkId),
    ]).catch((err) => this.logger.warn(`Failed to record access for link ${linkId}`, err));
  }

  // Persiste active=false assim que expiração/esgotamento é detectado, para que
  // `active` no banco seja sempre a fonte de verdade (sem cálculo derivado)
  private deactivateInBackground(slug: string): void {
    this.prisma.link
      .update({ where: { slug }, data: { active: false } })
      .catch((err) => this.logger.warn(`Failed to persist deactivation for '${slug}' (will retry on next hit)`));
  }

  private async incrementClickCount(linkId: string): Promise<void> {
    const key = REDIS_CLICK_ID(linkId);
    // incrby e expire são independentes entre si — não há motivo para serializar
    await Promise.all([
      this.redis.incrby(key, 1),
      this.redis.expire(key, this.clickCountTtlSeconds)
    ]);
  }

  private async logAccessAsync(
    linkId: string,
    referer?: string,
    userAgent?: string | string[],
    ip?: string,
  ) {
    const log: AccessLogEntry = {
      linkId,
      referer: referer || undefined,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      ip,
    };

    await this.redis.lpush(ACCESS_LOG_BUFFER_KEY, [JSON.stringify(log)]);

    const bufferLen = await this.redis.llen(ACCESS_LOG_BUFFER_KEY);
    if (bufferLen >= this.accessLogThreshold) {
      this.flushLogs().catch((err) => this.logger.error('Failed to flush logs', err));
    }
  }
}
