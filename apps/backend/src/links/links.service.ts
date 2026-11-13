import { PostgresService } from '../postgres/postgres.service.js';
import { RedisService } from '../redis/redis.service.js';
import { getNumber } from '../_core/config.js';
import { HttpError } from '../_core/http.js';
import { createLogger } from '../_core/logger.js';
import { generateSlug } from '../_core/slug.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { QueryLinksDto, LinkSortField, SortOrder } from './dto/query-links.dto.js';
import { LinkResponseDto, toLinkResponse } from './dto/link-response.dto.js';
import { Link, LinkRow, toLink } from './link.js';
import { LINK_BUFFER_KEY, REDIS_LINK_KEY, REDIS_LINK_DETAIL_KEY, REDIS_CLICK_COUNT_KEY, LINKS_LIST_CACHE_PREFIX } from '../_core/constants.js';

const sql = PostgresService.sql;

type CachedLink = Omit<Link, 'id'>;
type BufferedLink = {
  slug: string;
  url: string;
  expiresAt: string | null;
  maxClicks: number | null;
};

function stripId<T extends { id: unknown }>(obj: T): Omit<T, 'id'> {
  const { id, ...rest } = obj;
  return rest;
}

export function isEffectivelyActive(link: { active: boolean; expiresAt: Date | string | null }): boolean {
  if (!link.active) return false;
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return false;
  return true;
}

// Escapa os curingas do LIKE para que `q` seja sempre busca por substring literal
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export namespace LinksService {
  const logger = createLogger('LinksService');
  let flushInterval: Timer | null = null;
  // null quando ocioso; permite chamadores concorrentes aguardarem o flush em
  // curso em vez de desistir (ver ensureFlushed).
  let flushInFlight: Promise<void> | null = null;
  const localCache = new Map<string, { link: CachedLink; expiresAt: number }>();

  const linkBufferThreshold = getNumber('LINK_BUFFER_THRESHOLD', 20);
  const linkFlushIntervalMs = getNumber('LINK_FLUSH_INTERVAL_MS', 2000);
  // TTL curto: limita por quanto tempo o cache L1 fica desatualizado em
  // relação a uma desativação feita por outra instância.
  const localCacheTtlMs = getNumber('LOCAL_CACHE_TTL_MS', 2000);
  const localCacheMaxSize = getNumber('LOCAL_CACHE_MAX_SIZE', 1000);
  // O clickCount persistido só muda a cada flush de cliques (segundos), então
  // reler o banco por redirect não traz precisão; o limite maxClicks pode
  // estourar em até um TTL de cliques.
  const persistedCountTtlMs = getNumber('PERSISTED_COUNT_TTL_MS', 1000);
  const persistedCountCache = new Map<string, { count: number; expiresAt: number }>();

  export async function init() {
    await flushLinks();

    // Exige CPU always-allocated no Cloud Run (ver README "Cloud Run"),
    // senão o timer fica suspenso entre requests.
    flushInterval = setInterval(() => {
      flushLinks().catch((err) => logger.error('Failed to flush links', err));
    }, linkFlushIntervalMs);
  }

  export async function shutdown() {
    if (flushInterval) {
      clearInterval(flushInterval);
    }
    await flushLinks().catch((err) => logger.error('Failed final flush on shutdown', err));
  }

  // Aguarda o flush em andamento (se houver) e garante que um flush novo
  // rodou — usado pelo retry de updateWithFlushRetry, onde "se já está
  // flushando, desiste" deixaria o link sem persistir.
  async function ensureFlushed(): Promise<void> {
    if (flushInFlight) {
      await flushInFlight;
    }
    await flushLinks();
  }

  async function flushLinks(): Promise<void> {
    if (flushInFlight) {
      return flushInFlight;
    }

    flushInFlight = doFlushLinks().finally(() => {
      flushInFlight = null;
    });

    return flushInFlight;
  }

  async function doFlushLinks(): Promise<void> {
    const links = await RedisService.lpopall<BufferedLink>(LINK_BUFFER_KEY, 1000);

    if (links.length === 0) return;

    try {
      const now = new Date();
      const rows = links.map((l) => ({
        slug: l.slug,
        url: l.url,
        expires_at: l.expiresAt ? new Date(l.expiresAt) : null,
        max_clicks: l.maxClicks,
        updated_at: now,
      }));
      await sql`INSERT INTO links ${sql(rows, 'slug', 'url', 'expires_at', 'max_clicks', 'updated_at')}`;
    } catch (err) {
      logger.warn(`Failed to flush ${links.length} links (will retry)`);
      await RedisService.requeue(LINK_BUFFER_KEY, links.map((link) => JSON.stringify(link)));
    }
  }

  export async function create(dto: CreateLinkDto): Promise<LinkResponseDto> {
    const slug = dto.slug || generateSlug(7);

    if (dto.slug) {
      const cached = await RedisService.get(REDIS_LINK_KEY(dto.slug));
      if (cached) throw new HttpError(409, `Slug '${dto.slug}' is not available`);
      const [existing] = await sql`SELECT id FROM links WHERE slug = ${dto.slug}`;
      if (existing) throw new HttpError(409, `Slug '${dto.slug}' is not available`);
    }

    const now = new Date();
    const linkData: CachedLink = {
      slug,
      url: dto.url,
      active: true,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      maxClicks: dto.maxClicks ?? null,
      clickCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await RedisService.set(REDIS_LINK_KEY(slug), linkData, 3600);
    await RedisService.delByPattern(`${LINKS_LIST_CACHE_PREFIX}*`);

    const bufferedLink: BufferedLink = {
      slug,
      url: dto.url,
      expiresAt: dto.expiresAt || null,
      maxClicks: dto.maxClicks ?? null,
    };
    const bufferLen = await RedisService.rpush(LINK_BUFFER_KEY, [JSON.stringify(bufferedLink)]);
    if (bufferLen >= linkBufferThreshold) {
      flushLinks().catch((err) => logger.error('Failed to flush links', err));
    }

    return toLinkResponse({
      ...linkData,
      shortUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/${slug}`,
    });
  }

  const ORDER_BY = {
    createdAt: { asc: sql`created_at ASC`, desc: sql`created_at DESC` },
    clickCount: { asc: sql`click_count ASC`, desc: sql`click_count DESC` },
  } satisfies Record<LinkSortField, Record<SortOrder, unknown>>;

  export async function findAll(query: QueryLinksDto) {
    const { page, pageSize, q, sortField, sortOrder } = query;

    const cacheKey = `${LINKS_LIST_CACHE_PREFIX}${page}:${pageSize}:${q ?? ''}:${sortField}:${sortOrder}`;
    const cached = await RedisService.get<any>(cacheKey);
    if (cached) return cached;

    const where = q ? sql`WHERE slug ILIKE ${`%${escapeLike(q)}%`}` : sql``;

    // Ordena pelo clickCount persistido (fonte de verdade após o flush); o
    // delta pendente no Redis só é somado na exibição, não afeta a posição
    // na ordenação — trade-off necessário para paginar 100k+ links no banco.
    const [rows, [{ count }]] = await Promise.all([
      sql<LinkRow[]>`
        SELECT * FROM links
        ${where}
        ORDER BY ${ORDER_BY[sortField][sortOrder]}
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `,
      sql`SELECT COUNT(*) AS count FROM links ${where}`,
    ]);
    const links = rows.map(toLink);
    const total = Number(count);

    const pendingDeltas = await RedisService.getCounters(links.map((l) => REDIS_CLICK_COUNT_KEY(l.slug)));

    const items = links.map((link, i) =>
      toLinkResponse({
        ...link,
        clickCount: link.clickCount + pendingDeltas[i],
        active: isEffectivelyActive(link),
      }),
    );

    const result = {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };

    await RedisService.set(cacheKey, result, 15);

    return result;
  }

  export async function findOne(slug: string) {
    const cacheKey = REDIS_LINK_DETAIL_KEY(slug);
    const cached = await RedisService.get<LinkResponseDto>(cacheKey);
    if (cached) return cached;

    const [row] = await sql<LinkRow[]>`SELECT * FROM links WHERE slug = ${slug}`;

    if (!row) {
      throw new HttpError(404, `Link with slug '${slug}' not found`);
    }

    const link = toLink(row);
    const pendingDelta = await RedisService.getCounter(REDIS_CLICK_COUNT_KEY(link.slug));
    const result = toLinkResponse({
      ...link,
      clickCount: link.clickCount + pendingDelta,
      active: isEffectivelyActive(link),
    });

    await RedisService.set(cacheKey, result, 30);

    return result;
  }

  export async function deactivate(slug: string): Promise<LinkResponseDto> {
    const link = await findBySlug(slug);

    if (!link) {
      throw new HttpError(404, `Link with slug '${slug}' not found`);
    }

    const updated = await updateWithFlushRetry(slug, false);

    await invalidate(slug);

    return toLinkResponse(updated);
  }

  export async function reactivate(slug: string): Promise<LinkResponseDto> {
    const link = await findBySlug(slug);

    if (!link) {
      throw new HttpError(404, `Link with slug '${slug}' not found`);
    }

    if (link.maxClicks) {
      const pendingDelta = await RedisService.getCounter(REDIS_CLICK_COUNT_KEY(slug));
      const clickCount = link.clickCount + pendingDelta;
      if (clickCount > link.maxClicks) {
        throw new HttpError(
          422,
          `Link '${slug}' reached its click limit (${link.maxClicks}) and cannot be reactivated`,
        );
      }
    }

    const updated = await updateWithFlushRetry(slug, true);

    await RedisService.set(REDIS_LINK_KEY(slug), stripId(updated), 3600);
    await RedisService.delByPattern(`${LINKS_LIST_CACHE_PREFIX}*`);
    await RedisService.del(REDIS_LINK_DETAIL_KEY(slug));
    localCache.delete(slug);

    return toLinkResponse(updated);
  }

  // Invalida L1 e L2 de um slug; público para outros services (ex: RedirectService) usarem.
  export async function invalidate(slug: string): Promise<void> {
    await RedisService.del(REDIS_LINK_KEY(slug));
    await RedisService.delByPattern(`${LINKS_LIST_CACHE_PREFIX}*`);
    await RedisService.del(REDIS_LINK_DETAIL_KEY(slug));
    localCache.delete(slug);
  }

  // create() não é atômico: entre o cache ser populado e o rpush no buffer,
  // uma requisição concorrente pode achar o link via findBySlug (cache) mas
  // ainda não no buffer nem no Postgres. Sem isso, o update não acharia a linha.
  const MAX_UPDATE_RETRY_ATTEMPTS = 3;
  const UPDATE_RETRY_DELAY_MS = 50;

  async function updateActive(slug: string, active: boolean): Promise<Link | null> {
    const [row] = await sql<LinkRow[]>`
      UPDATE links SET active = ${active}, updated_at = now() WHERE slug = ${slug} RETURNING *
    `;
    return row ? toLink(row) : null;
  }

  async function updateWithFlushRetry(slug: string, active: boolean): Promise<Link> {
    const [exists] = await sql`SELECT slug FROM links WHERE slug = ${slug}`;
    if (!exists) {
      await ensureFlushed();
    }

    for (let attempt = 1; attempt <= MAX_UPDATE_RETRY_ATTEMPTS; attempt++) {
      const updated = await updateActive(slug, active);
      if (updated) return updated;

      if (attempt === MAX_UPDATE_RETRY_ATTEMPTS) break;
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, UPDATE_RETRY_DELAY_MS));
      }
      await ensureFlushed();
    }
    throw new HttpError(404, `Link with slug '${slug}' not found`);
  }

  export async function findBySlug(slug: string): Promise<CachedLink | null> {
    const localHit = getFromLocalCache(slug);
    if (localHit) return localHit;

    const cached = await RedisService.get<CachedLink>(REDIS_LINK_KEY(slug));
    if (cached) {
      setLocalCache(slug, cached);
      return cached;
    }

    const [row] = await sql<LinkRow[]>`SELECT * FROM links WHERE slug = ${slug}`;
    if (row) {
      const withoutId = stripId(toLink(row));
      await RedisService.set(REDIS_LINK_KEY(slug), withoutId, 3600);
      setLocalCache(slug, withoutId);
      return withoutId;
    }

    return null;
  }

  function getFromLocalCache(slug: string): CachedLink | null {
    const entry = localCache.get(slug);
    if (!entry) return null;

    if (entry.expiresAt < Date.now()) {
      localCache.delete(slug);
      return null;
    }

    localCache.delete(slug);
    localCache.set(slug, entry);
    return entry.link;
  }

  function setLocalCache(slug: string, link: CachedLink): void {
    if (localCache.size >= localCacheMaxSize && !localCache.has(slug)) {
      const oldestKey = localCache.keys().next().value;
      if (oldestKey !== undefined) localCache.delete(oldestKey);
    }
    localCache.set(slug, { link, expiresAt: Date.now() + localCacheTtlMs });
  }

  // Ignora o cache do link: seu snapshot de clickCount não é refrescado
  // pelos flushes periódicos de clique.
  export async function getPersistedClickCount(slug: string): Promise<number> {
    const [row] = await sql`SELECT click_count FROM links WHERE slug = ${slug}`;
    return row?.click_count ?? 0;
  }

  // Versão com cache curto para o hot path do redirect (ver persistedCountTtlMs).
  export async function getPersistedClickCountCached(slug: string): Promise<number> {
    const entry = persistedCountCache.get(slug);
    if (entry && entry.expiresAt > Date.now()) return entry.count;

    const count = await getPersistedClickCount(slug);
    if (persistedCountCache.size >= localCacheMaxSize) persistedCountCache.clear();
    persistedCountCache.set(slug, { count, expiresAt: Date.now() + persistedCountTtlMs });
    return count;
  }

  // Ignora o cache do link: ele nunca tem id (ver stripId).
  export async function getPersistedId(slug: string): Promise<string | null> {
    const [row] = await sql`SELECT id FROM links WHERE slug = ${slug}`;
    return row?.id ?? null;
  }
}
