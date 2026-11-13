import { PostgresService } from '../postgres/postgres.service.js';
import { RedisService } from '../redis/redis.service.js';
import { LinksService } from '../links/links.service.js';
import { getNumber } from '../_core/config.js';
import { createLogger } from '../_core/logger.js';
import { ACCESS_LOG_BUFFER_KEY, REDIS_CLICK_COUNT_KEY } from '../_core/constants.js';

const sql = PostgresService.sql;

export enum RedirectStatus {
  OK = 'ok',
  GONE = 'gone',
}

type RedirectResult = {
  url: string;
  status: RedirectStatus;
};

export type AccessInfo = {
  referer?: string;
  userAgent?: string;
  ip?: string;
};

type AccessLogEntry = AccessInfo & { slug: string };

export namespace RedirectService {
  const logger = createLogger('RedirectService');
  let flushInterval: Timer | null = null;
  let redisFlushInterval: Timer | null = null;
  let isFlushing = false;
  let pendingLogs: string[] = [];
  let pendingClicks = new Map<string, number>();

  const accessLogThreshold = getNumber('ACCESS_LOG_THRESHOLD', 100);
  const accessLogFlushIntervalMs = getNumber('ACCESS_LOG_FLUSH_INTERVAL_MS', 5000);
  const accessLogFlushBatchSize = getNumber('ACCESS_LOG_FLUSH_BATCH_SIZE', 1000);
  const clickCountTtlSeconds = getNumber('CLICK_COUNT_TTL_SECONDS', 3600);
  const redisPushIntervalMs = getNumber('ACCESS_REDIS_PUSH_INTERVAL_MS', 100);
  const redisPushMaxBatch = getNumber('ACCESS_REDIS_PUSH_MAX_BATCH', 500);

  export async function init() {
    await flushLogs();

    // Exige CPU always-allocated no Cloud Run (ver README "Cloud Run"),
    // senão o timer fica suspenso entre requests.
    flushInterval = setInterval(() => {
      flushLogs().catch((err) => logger.error('Failed to flush logs', err));
    }, accessLogFlushIntervalMs);

    redisFlushInterval = setInterval(() => {
      pushPendingToRedis().catch((err) => logger.error('Failed to push accesses to Redis', err));
    }, redisPushIntervalMs);
  }

  export async function shutdown() {
    if (flushInterval) {
      clearInterval(flushInterval);
    }
    if (redisFlushInterval) {
      clearInterval(redisFlushInterval);
    }
    await pushPendingToRedis().catch((err) => logger.error('Failed final push to Redis', err));
    await flushLogs().catch((err) => logger.error('Failed final flush on shutdown', err));
  }

  async function flushLogs() {
    if (isFlushing) return;

    try {
      isFlushing = true;

      let logs = await RedisService.lpopall<AccessLogEntry>(ACCESS_LOG_BUFFER_KEY, accessLogFlushBatchSize);

      while (logs.length > 0) {
        await flushBatch(logs);

        if (logs.length < accessLogFlushBatchSize) break;

        logs = await RedisService.lpopall(ACCESS_LOG_BUFFER_KEY, accessLogFlushBatchSize);
      }
    } finally {
      isFlushing = false;
    }
  }

  async function flushBatch(logs: AccessLogEntry[]) {
    const slugs = Array.from(new Set(logs.map((log) => log.slug)));
    const links = await sql<{ id: string; slug: string }[]>`SELECT id, slug FROM links WHERE slug IN ${sql(slugs)}`;
    const idBySlug = new Map(links.map((l) => [l.slug, l.id]));

    const resolvedLogs = logs
      .map((log) => {
        const linkId = idBySlug.get(log.slug);
        if (linkId === undefined) return null;
        return { link_id: linkId, referer: log.referer ?? null, user_agent: log.userAgent ?? null, ip: log.ip ?? null };
      })
      .filter((log): log is NonNullable<typeof log> => log !== null);

    const unresolvedLogs = logs.filter((log) => !idBySlug.has(log.slug));

    try {
      if (resolvedLogs.length > 0) {
        await sql`INSERT INTO access_logs ${sql(resolvedLogs, 'link_id', 'referer', 'user_agent', 'ip')}`;
      }
    } catch (err) {
      logger.warn(`Failed to flush ${resolvedLogs.length} access logs (will retry)`);
      await RedisService.lpush(ACCESS_LOG_BUFFER_KEY, logs.map((log) => JSON.stringify(log)));
      return;
    }

    if (unresolvedLogs.length > 0) {
      logger.warn(`${unresolvedLogs.length} access logs waiting for their link to persist (will retry)`);
      await RedisService.lpush(ACCESS_LOG_BUFFER_KEY, unresolvedLogs.map((log) => JSON.stringify(log)));
    }

    await flushClickCounts(logs.map((log) => log.slug));
  }

  async function flushClickCounts(slugs: string[]) {
    const deltaBySlug = new Map<string, number>();
    slugs.forEach((slug) => deltaBySlug.set(slug, (deltaBySlug.get(slug) ?? 0) + 1));

    const entries = Array.from(deltaBySlug.entries());

    try {
      await sql`
        UPDATE links AS l
        SET click_count = l.click_count + d.delta
        FROM (
          SELECT * FROM UNNEST(
            ${sql.array(entries.map(([slug]) => slug), 'TEXT')}::text[],
            ${sql.array(entries.map(([, delta]) => delta), 'INT')}::int[]
          ) AS t(slug, delta)
        ) AS d
        WHERE l.slug = d.slug
      `;

      for (const [slug, delta] of entries) {
        await RedisService.incrby(REDIS_CLICK_COUNT_KEY(slug), -delta);
      }
    } catch (err) {
      logger.warn(`Failed to sync click counts for ${entries.length} links (will retry)`);
    }
  }

  export async function processRedirect(slug: string, access: AccessInfo): Promise<RedirectResult | null> {
    const link = await LinksService.findBySlug(slug);

    if (!link) {
      return null;
    }

    if (!link.active) {
      return { url: '', status: RedirectStatus.GONE };
    }

    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      LinksService.invalidate(slug).catch(() => { });
      deactivateInBackground(slug);
      return { url: '', status: RedirectStatus.GONE };
    }

    if (link.maxClicks) {
      const [persistedCount, pendingDelta] = await Promise.all([
        LinksService.getPersistedClickCount(slug),
        RedisService.getCounter(REDIS_CLICK_COUNT_KEY(slug)),
      ]);
      const clickCount = persistedCount + pendingDelta;
      if (clickCount > link.maxClicks) {
        LinksService.invalidate(slug).catch(() => { });
        deactivateInBackground(slug);
        return { url: '', status: RedirectStatus.GONE };
      }
    }

    recordAccess(slug, access);

    return { url: link.url, status: RedirectStatus.OK };
  }

  function recordAccess(slug: string, access: AccessInfo): void {
    const log: AccessLogEntry = {
      slug,
      referer: access.referer || undefined,
      userAgent: access.userAgent,
      ip: access.ip,
    };

    pendingLogs.push(JSON.stringify(log));
    pendingClicks.set(slug, (pendingClicks.get(slug) ?? 0) + 1);

    if (pendingLogs.length >= redisPushMaxBatch) {
      pushPendingToRedis().catch((err) => logger.error('Failed to push accesses to Redis', err));
    }
  }

  function deactivateInBackground(slug: string): void {
    sql`UPDATE links SET active = false, updated_at = now() WHERE slug = ${slug}`
      .catch((err) => logger.warn(`Failed to persist deactivation for '${slug}' (will retry on next hit)`));
  }

  // Um round-trip por lote (não por click). Se falhar, devolve o lote ao buffer
  // em memória para a próxima tentativa.
  async function pushPendingToRedis(): Promise<void> {
    if (pendingLogs.length === 0) return;

    const logs = pendingLogs;
    const clicks = pendingClicks;
    pendingLogs = [];
    pendingClicks = new Map();

    try {
      const bufferLen = await RedisService.pushBatch(
        ACCESS_LOG_BUFFER_KEY,
        logs,
        new Map([...clicks].map(([slug, delta]) => [REDIS_CLICK_COUNT_KEY(slug), delta])),
        clickCountTtlSeconds,
      );

      if (bufferLen >= accessLogThreshold) {
        flushLogs().catch((err) => logger.error('Failed to flush logs', err));
      }
    } catch (err) {
      pendingLogs.unshift(...logs);
      for (const [slug, delta] of clicks) {
        pendingClicks.set(slug, (pendingClicks.get(slug) ?? 0) + delta);
      }
      throw err;
    }
  }
}
