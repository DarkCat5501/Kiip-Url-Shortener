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
    // Em background: o backlog herdado do Redis pode ser grande e não deve atrasar o boot.
    flushLogs().catch((err) => logger.error('Failed to flush logs', err));

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

  // Um único statement (atômico sob READ COMMITTED, o padrão do Postgres): insere
  // os logs, soma os cliques em links e devolve só os slugs que existem no banco.
  // O delta pendente no Redis é abatido apenas pelo que foi de fato persistido;
  // logs de links ainda não persistidos voltam ao buffer.
  async function flushBatch(logs: AccessLogEntry[]) {
    let persisted: { slug: string; n: number }[];

    try {
      persisted = await sql<{ slug: string; n: number }[]>`
        WITH batch AS (
          SELECT * FROM UNNEST(
            ${sql.array(logs.map((l) => l.slug), 'TEXT')}::text[],
            ${sql.array(logs.map((l) => l.referer ?? null), 'TEXT')}::text[],
            ${sql.array(logs.map((l) => l.userAgent ?? null), 'TEXT')}::text[],
            ${sql.array(logs.map((l) => l.ip ?? null), 'TEXT')}::text[]
          ) AS t(slug, referer, user_agent, ip)
        ), ins AS (
          INSERT INTO access_logs (link_id, referer, user_agent, ip)
          SELECT l.id, b.referer, b.user_agent, b.ip
          FROM batch b JOIN links l ON l.slug = b.slug
          RETURNING link_id
        ), counts AS (
          SELECT link_id, COUNT(*)::int AS n FROM ins GROUP BY link_id
        ), upd AS (
          UPDATE links l SET click_count = l.click_count + c.n
          FROM counts c WHERE l.id = c.link_id
          RETURNING l.slug, c.n
        )
        SELECT slug, n FROM upd
      `;
    } catch (err) {
      logger.warn(`Failed to flush ${logs.length} access logs (will retry)`);
      await RedisService.requeue(ACCESS_LOG_BUFFER_KEY, logs.map((log) => JSON.stringify(log)));
      return;
    }

    const persistedSlugs = new Set(persisted.map((row) => row.slug));
    const unresolvedLogs = logs.filter((log) => !persistedSlugs.has(log.slug));

    if (unresolvedLogs.length > 0) {
      logger.warn(`${unresolvedLogs.length} access logs waiting for their link to persist (will retry)`);
      await RedisService.requeue(ACCESS_LOG_BUFFER_KEY, unresolvedLogs.map((log) => JSON.stringify(log)));
    }

    try {
      await RedisService.incrbyMany(new Map(persisted.map(({ slug, n }) => [REDIS_CLICK_COUNT_KEY(slug), -n])));
    } catch (err) {
      logger.warn(`Failed to decrement pending click counts for ${persisted.length} links`);
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
        LinksService.getPersistedClickCountCached(slug),
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
