import { Injectable, ConflictException, NotFoundException, UnprocessableEntityException, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { QueryLinksDto, LinkSortField } from './dto/query-links.dto.js';
import { LinkResponseDto } from './dto/link-response.dto.js';
import { LINK_BUFFER_KEY, REDIS_LINK_KEY, REDIS_LINK_DETAIL_KEY, REDIS_CLICK_COUNT_KEY, LINKS_LIST_CACHE_PREFIX } from '../_core/constants.js';
import { nanoid } from 'nanoid';
import type { Link, Prisma } from '@prisma/client';

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

export function isEffectivelyActive(link: { active: boolean; expiresAt: Date | null }): boolean {
  if (!link.active) return false;
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return false;
  return true;
}

@Injectable()
export class LinksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LinksService.name);
  private flushInterval: NodeJS.Timeout | null = null;
  // null quando ocioso; permite chamadores concorrentes aguardarem o flush em
  // curso em vez de desistir (ver ensureFlushed).
  private flushInFlight: Promise<void> | null = null;
  private localCache = new Map<string, { link: CachedLink; expiresAt: number }>();

  private readonly linkBufferThreshold: number;
  private readonly linkFlushIntervalMs: number;
  private readonly localCacheTtlMs: number;
  private readonly localCacheMaxSize: number;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private config: ConfigService,
  ) {
    this.linkBufferThreshold = this.config.get<number>('LINK_BUFFER_THRESHOLD', 20);
    this.linkFlushIntervalMs = this.config.get<number>('LINK_FLUSH_INTERVAL_MS', 2000);
    // TTL curto: limita por quanto tempo o cache L1 fica desatualizado em
    // relação a uma desativação feita por outra instância.
    this.localCacheTtlMs = this.config.get<number>('LOCAL_CACHE_TTL_MS', 2000);
    this.localCacheMaxSize = this.config.get<number>('LOCAL_CACHE_MAX_SIZE', 1000);
  }

  async onModuleInit() {
    await this.flushLinks();

    // Exige CPU always-allocated no Cloud Run (ver README "Cloud Run"),
    // senão o timer fica suspenso entre requests.
    this.flushInterval = setInterval(() => {
      this.flushLinks().catch((err) => this.logger.error('Failed to flush links', err));
    }, this.linkFlushIntervalMs);
  }

  async onModuleDestroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flushLinks().catch((err) => this.logger.error('Failed final flush on shutdown', err));
  }

  // Aguarda o flush em andamento (se houver) e garante que um flush novo
  // rodou — usado pelo retry de updateWithFlushRetry, onde "se já está
  // flushando, desiste" deixaria o link sem persistir.
  private async ensureFlushed(): Promise<void> {
    if (this.flushInFlight) {
      await this.flushInFlight;
    }
    await this.flushLinks();
  }

  private async flushLinks(): Promise<void> {
    if (this.flushInFlight) {
      return this.flushInFlight;
    }

    this.flushInFlight = this.doFlushLinks().finally(() => {
      this.flushInFlight = null;
    });

    return this.flushInFlight;
  }

  private async doFlushLinks(): Promise<void> {
    const links = await this.redis.lpopall<BufferedLink>(LINK_BUFFER_KEY, 1000);

    if (links.length === 0) return;

    try {
      await this.prisma.link.createMany({
        data: links.map((l) => ({
          slug: l.slug,
          url: l.url,
          expiresAt: l.expiresAt ? new Date(l.expiresAt) : null,
          maxClicks: l.maxClicks,
        })),
      });
    } catch (err) {
      this.logger.warn(`Failed to flush ${links.length} links (will retry)`);
      await this.redis.lpush(LINK_BUFFER_KEY, links.map((link) => JSON.stringify(link)));
    }
  }

  async create(dto: CreateLinkDto): Promise<LinkResponseDto> {
    const slug = dto.slug || nanoid(7);

    if (dto.slug) {
      const cached = await this.redis.get(REDIS_LINK_KEY(dto.slug));
      if (cached) throw new ConflictException(`Slug '${dto.slug}' is not available`);
      const existing = await this.prisma.link.findUnique({ where: { slug: dto.slug } });
      if (existing) throw new ConflictException(`Slug '${dto.slug}' is not available`);
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

    await this.redis.set(REDIS_LINK_KEY(slug), linkData, 3600);
    await this.redis.delByPattern(`${LINKS_LIST_CACHE_PREFIX}*`);

    const bufferedLink: BufferedLink = {
      slug,
      url: dto.url,
      expiresAt: dto.expiresAt || null,
      maxClicks: dto.maxClicks ?? null,
    };
    await this.redis.lpush(LINK_BUFFER_KEY, [JSON.stringify(bufferedLink)]);

    const bufferLen = await this.redis.llen(LINK_BUFFER_KEY);
    if (bufferLen >= this.linkBufferThreshold) {
      this.flushLinks().catch((err) => this.logger.error('Failed to flush links', err));
    }

    return new LinkResponseDto({
      ...linkData,
      shortUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/${slug}`,
    });
  }

  async findAll(query: QueryLinksDto) {
    const { page, pageSize, q, sortField, sortOrder } = query;

    const cacheKey = `${LINKS_LIST_CACHE_PREFIX}${page}:${pageSize}:${q ?? ''}:${sortField}:${sortOrder}`;
    const cached = await this.redis.get<any>(cacheKey);
    if (cached) {
      return { ...cached, items: cached.items.map((item: any) => new LinkResponseDto(item)) };
    }

    const where: Prisma.LinkWhereInput = q
      ? { slug: { contains: q, mode: 'insensitive' } }
      : {};

    // Ordena pelo clickCount persistido (fonte de verdade após o flush); o
    // delta pendente no Redis só é somado na exibição, não afeta a posição
    // na ordenação — trade-off necessário para paginar 100k+ links no banco.
    const orderBy: Prisma.LinkOrderByWithRelationInput =
      sortField === LinkSortField.ClickCount
        ? { clickCount: sortOrder }
        : { createdAt: sortOrder };

    const [links, total] = await Promise.all([
      this.prisma.link.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.link.count({ where }),
    ]);

    const pendingDeltas = await this.redis.getCounters(links.map((l) => REDIS_CLICK_COUNT_KEY(l.slug)));

    const items = links.map((link, i) =>
      ({
        ...stripId(link),
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

    await this.redis.set(cacheKey, result, 15);

    return { ...result, items: items.map((item) => new LinkResponseDto(item)) };
  }

  async findOne(slug: string) {
    const cacheKey = REDIS_LINK_DETAIL_KEY(slug);
    const cached = await this.redis.get<any>(cacheKey);
    if (cached) return new LinkResponseDto(cached);

    const link = await this.prisma.link.findUnique({ where: { slug } });

    if (!link) {
      throw new NotFoundException(`Link with slug '${slug}' not found`);
    }

    const pendingDelta = await this.redis.getCounter(REDIS_CLICK_COUNT_KEY(link.slug));
    const result = {
      ...stripId(link),
      clickCount: link.clickCount + pendingDelta,
      active: isEffectivelyActive(link),
    };

    await this.redis.set(cacheKey, result, 30);

    return new LinkResponseDto(result);
  }

  async deactivate(slug: string): Promise<LinkResponseDto> {
    const link = await this.findBySlug(slug);

    if (!link) {
      throw new NotFoundException(`Link with slug '${slug}' not found`);
    }

    const updated = await this.updateWithFlushRetry(slug, { active: false });

    await this.redis.del(REDIS_LINK_KEY(slug));
    await this.redis.delByPattern(`${LINKS_LIST_CACHE_PREFIX}*`);
    await this.redis.del(REDIS_LINK_DETAIL_KEY(slug));
    this.localCache.delete(slug);

    return new LinkResponseDto(updated);
  }

  async reactivate(slug: string): Promise<LinkResponseDto> {
    const link = await this.findBySlug(slug);

    if (!link) {
      throw new NotFoundException(`Link with slug '${slug}' not found`);
    }

    if (link.maxClicks) {
      const pendingDelta = await this.redis.getCounter(REDIS_CLICK_COUNT_KEY(slug));
      const clickCount = link.clickCount + pendingDelta;
      if (clickCount > link.maxClicks) {
        throw new UnprocessableEntityException(
          `Link '${slug}' reached its click limit (${link.maxClicks}) and cannot be reactivated`,
        );
      }
    }

    const updated = await this.updateWithFlushRetry(slug, { active: true });

    await this.redis.set(REDIS_LINK_KEY(slug), stripId(updated), 3600);
    await this.redis.delByPattern(`${LINKS_LIST_CACHE_PREFIX}*`);
    await this.redis.del(REDIS_LINK_DETAIL_KEY(slug));
    this.localCache.delete(slug);

    return new LinkResponseDto(updated);
  }

  // create() não é atômico: entre o cache ser populado e o lpush no buffer,
  // uma requisição concorrente pode achar o link via findBySlug (cache) mas
  // ainda não no buffer nem no Postgres. Sem isso, o update dispararia P2025.
  private static readonly MAX_UPDATE_RETRY_ATTEMPTS = 3;
  private static readonly UPDATE_RETRY_DELAY_MS = 50;

  private async updateWithFlushRetry(slug: string, data: Prisma.LinkUpdateInput): Promise<Link> {
    const exists = await this.prisma.link.findUnique({ where: { slug }, select: { slug: true } });
    if (!exists) {
      await this.ensureFlushed();
    }

    for (let attempt = 1; attempt <= LinksService.MAX_UPDATE_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.link.update({ where: { slug }, data });
      } catch (err) {
        const isLastAttempt = attempt === LinksService.MAX_UPDATE_RETRY_ATTEMPTS;
        if ((err as { code?: string }).code !== 'P2025' || isLastAttempt) {
          throw err;
        }
        if (attempt > 1) {
          await new Promise((resolve) => setTimeout(resolve, LinksService.UPDATE_RETRY_DELAY_MS));
        }
        await this.ensureFlushed();
      }
    }
    throw new NotFoundException(`Link with slug '${slug}' not found`);
  }

  async findBySlug(slug: string): Promise<CachedLink | null> {
    const localHit = this.getFromLocalCache(slug);
    if (localHit) return localHit;

    const cached = await this.redis.get<CachedLink>(REDIS_LINK_KEY(slug));
    if (cached) {
      this.setLocalCache(slug, cached);
      return cached;
    }

    const link = await this.prisma.link.findUnique({ where: { slug } });
    if (link) {
      const withoutId = stripId(link);
      await this.redis.set(REDIS_LINK_KEY(slug), withoutId, 3600);
      this.setLocalCache(slug, withoutId);
      return withoutId;
    }

    return null;
  }

  private getFromLocalCache(slug: string): CachedLink | null {
    const entry = this.localCache.get(slug);
    if (!entry) return null;

    if (entry.expiresAt < Date.now()) {
      this.localCache.delete(slug);
      return null;
    }

    this.localCache.delete(slug);
    this.localCache.set(slug, entry);
    return entry.link;
  }

  private setLocalCache(slug: string, link: CachedLink): void {
    if (this.localCache.size >= this.localCacheMaxSize && !this.localCache.has(slug)) {
      const oldestKey = this.localCache.keys().next().value;
      if (oldestKey !== undefined) this.localCache.delete(oldestKey);
    }
    this.localCache.set(slug, { link, expiresAt: Date.now() + this.localCacheTtlMs });
  }

  // Ignora o cache do link: seu snapshot de clickCount não é refrescado
  // pelos flushes periódicos de clique.
  async getPersistedClickCount(slug: string): Promise<number> {
    const link = await this.prisma.link.findUnique({
      where: { slug },
      select: { clickCount: true },
    });
    return link?.clickCount ?? 0;
  }

  // Ignora o cache do link: ele nunca tem id (ver stripId).
  async getPersistedId(slug: string): Promise<bigint | null> {
    const link = await this.prisma.link.findUnique({
      where: { slug },
      select: { id: true },
    });
    return link?.id ?? null;
  }
}
