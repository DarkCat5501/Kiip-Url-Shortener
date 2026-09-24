import { Injectable, ConflictException, NotFoundException, UnprocessableEntityException, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { QueryLinksDto, LinkSortField } from './dto/query-links.dto.js';
import { nanoid } from 'nanoid';
import type { Link, Prisma } from '@prisma/client';

const LINK_BUFFER_KEY = 'buffer:links';

type BufferedLink = {
  id: string;
  slug: string;
  url: string;
  expiresAt: string | null;
  maxClicks: number | null;
};

// `active` no banco é a fonte de verdade: o redirect persiste active=false
// assim que detecta expiração ou esgotamento de maxClicks num acesso real.
// A única janela residual é um link expirado por data que nunca mais foi
// acessado desde então — expiresAt é barato de checar (timestamp), então
// cobrimos esse caso aqui sem depender de nenhum clique disparar a detecção.
export function isEffectivelyActive(link: { active: boolean; expiresAt: Date | null }): boolean {
  if (!link.active) return false;
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return false;
  return true;
}

function omitNullFields<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== null),
  ) as Partial<T>;
}

@Injectable()
export class LinksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LinksService.name);
  private flushInterval: NodeJS.Timeout | null = null;
  private isFlushing = false;
  // Cache L1 em memória do processo — comparação experimental contra o cache
  // Redis (L2) para isolar se a latência sob carga vem do roundtrip de rede
  // ao Redis ou de outra fonte (ex: saturação do event loop).
  // Nota: expiração/esgotamento detectados no RedirectService não invalidam
  // essa camada explicitamente — o TTL curto já limita a janela de
  // inconsistência, e esses eventos são raros comparados ao volume de
  // redirects normais, então não vale o acoplamento extra entre os services.
  private localCache = new Map<string, { link: Link; expiresAt: number }>();

  private readonly linkBufferThreshold: number;
  private readonly linkFlushIntervalMs: number;
  private readonly localCacheTtlMs: number;
  private readonly localCacheMaxSize: number;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private config: ConfigService,
  ) {
    // Quantidade de links no buffer que dispara um flush imediato (além do timer periódico)
    this.linkBufferThreshold = this.config.get<number>('LINK_BUFFER_THRESHOLD', 20);
    // Intervalo do flush periódico do buffer de links, em milissegundos
    this.linkFlushIntervalMs = this.config.get<number>('LINK_FLUSH_INTERVAL_MS', 2000);
    // TTL do cache L1 em memória: curto o bastante para não deixar o cache
    // desatualizado por muito tempo em relação a desativações feitas por outra instância
    this.localCacheTtlMs = this.config.get<number>('LOCAL_CACHE_TTL_MS', 2000);
    // Limita a memória do processo: só os slugs mais acessados recentemente
    // ficam em cache local (LRU), o resto sempre passa pelo Redis
    this.localCacheMaxSize = this.config.get<number>('LOCAL_CACHE_MAX_SIZE', 1000);
  }

  async onModuleInit() {
    await this.flushLinks();

    this.flushInterval = setInterval(() => {
      this.flushLinks().catch((err) => this.logger.error('Failed to flush links', err));
    }, this.linkFlushIntervalMs);
  }

  onModuleDestroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
  }

  private async flushLinks() {
    // Evita flushes concorrentes disparados simultaneamente pelo timer e pelo threshold
    if (this.isFlushing) return;
    this.isFlushing = true;

    try {
      const links = await this.redis.lpopall<BufferedLink>(LINK_BUFFER_KEY, 1000);

      if (links.length === 0) return;

      try {
        await this.prisma.link.createMany({
          data: links.map((l) => ({
            id: l.id,
            slug: l.slug,
            url: l.url,
            expiresAt: l.expiresAt ? new Date(l.expiresAt) : null,
            maxClicks: l.maxClicks,
          })),
        });
      } catch (err) {
        // Silently ignore - data is in Redis, will retry on next flush
        this.logger.warn(`Failed to flush ${links.length} links (will retry)`);
        await this.redis.lpush(LINK_BUFFER_KEY, links.map((link) => JSON.stringify(link)));
      }
    } finally {
      this.isFlushing = false;
    }
  }

  async create(dto: CreateLinkDto): Promise<Link & { shortUrl: string }> {
    const slug = dto.slug || nanoid(7);

    if (dto.slug) {
      const cached = await this.redis.get(`link:${dto.slug}`);
      if (cached) throw new ConflictException(`Slug '${dto.slug}' is not available`);
      const existing = await this.prisma.link.findUnique({ where: { slug: dto.slug } });
      if (existing) throw new ConflictException(`Slug '${dto.slug}' is not available`);
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const linkData: Link = {
      id,
      slug,
      url: dto.url,
      active: true,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      maxClicks: dto.maxClicks ?? null,
      clickCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.redis.set(`link:${slug}`, linkData, 3600);
    await this.redis.delByPattern('links:list:*');

    const bufferedLink: BufferedLink = {
      id,
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

    return {
      ...linkData,
      shortUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/${slug}`,
    };
  }

  async findAll(query: QueryLinksDto) {
    const { page, pageSize, q, sortField, sortOrder } = query;

    // Chave de cache inclui todos os parâmetros para não misturar resultados
    const cacheKey = `links:list:${page}:${pageSize}:${q ?? ''}:${sortField}:${sortOrder}`;
    const cached = await this.redis.get<any>(cacheKey);
    if (cached) return cached;

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

    // Um único roundtrip ao Redis para todos os deltas pendentes, em vez de um por link
    const pendingDeltas = await this.redis.getCounters(links.map((l) => `clicks:${l.id}`));

    const items = links.map((link, i) =>
      omitNullFields({
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

    await this.redis.set(cacheKey, result, 15);

    return result;
  }

  async findOne(slug: string) {
    const cacheKey = `link:${slug}:detail`;
    const cached = await this.redis.get<any>(cacheKey);
    if (cached) return cached;

    const link = await this.prisma.link.findUnique({ where: { slug } });

    if (!link) {
      throw new NotFoundException(`Link with slug '${slug}' not found`);
    }

    const pendingDelta = await this.redis.getCounter(`clicks:${link.id}`);
    const result = {
      ...link,
      clickCount: link.clickCount + pendingDelta,
      active: isEffectivelyActive(link),
    };

    await this.redis.set(cacheKey, result, 30);

    return result;
  }

  async deactivate(slug: string): Promise<Link> {
    const link = await this.findBySlug(slug);

    if (!link) {
      throw new NotFoundException(`Link with slug '${slug}' not found`);
    }

    const updated = await this.updateWithFlushRetry(slug, { active: false });

    await this.redis.del(`link:${slug}`);
    await this.redis.delByPattern('links:list:*');
    await this.redis.del(`link:${slug}:detail`);
    this.localCache.delete(slug);

    return updated;
  }

  async reactivate(slug: string): Promise<Link> {
    const link = await this.findBySlug(slug);

    if (!link) {
      throw new NotFoundException(`Link with slug '${slug}' not found`);
    }

    if (link.maxClicks) {
      const pendingDelta = await this.redis.getCounter(`clicks:${link.id}`);
      const clickCount = link.clickCount + pendingDelta;
      if (clickCount > link.maxClicks) {
        throw new UnprocessableEntityException(
          `Link '${slug}' reached its click limit (${link.maxClicks}) and cannot be reactivated`,
        );
      }
    }

    const updated = await this.updateWithFlushRetry(slug, { active: true });

    await this.redis.set(`link:${slug}`, updated, 3600);
    await this.redis.delByPattern('links:list:*');
    await this.redis.del(`link:${slug}:detail`);
    this.localCache.delete(slug);

    return updated;
  }

  // P2025: link ainda só existe no buffer, não no Postgres — força flush e retenta
  private async updateWithFlushRetry(slug: string, data: Prisma.LinkUpdateInput): Promise<Link> {
    try {
      return await this.prisma.link.update({ where: { slug }, data });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') {
        await this.flushLinks();
        return this.prisma.link.update({ where: { slug }, data });
      }
      throw err;
    }
  }

  async findBySlug(slug: string): Promise<Link | null> {
    const localHit = this.getFromLocalCache(slug);
    if (localHit) return localHit;

    const cached = await this.redis.get<Link>(`link:${slug}`);
    if (cached) {
      this.setLocalCache(slug, cached);
      return cached;
    }

    const link = await this.prisma.link.findUnique({ where: { slug } });
    if (link) {
      await this.redis.set(`link:${slug}`, link, 3600);
      this.setLocalCache(slug, link);
    }

    return link;
  }

  private getFromLocalCache(slug: string): Link | null {
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

  private setLocalCache(slug: string, link: Link): void {
    if (this.localCache.size >= this.localCacheMaxSize && !this.localCache.has(slug)) {
      // Remove o item menos recentemente usado (primeira chave inserida no Map)
      const oldestKey = this.localCache.keys().next().value;
      if (oldestKey !== undefined) this.localCache.delete(oldestKey);
    }
    this.localCache.set(slug, { link, expiresAt: Date.now() + this.localCacheTtlMs });
  }

  // Lê clickCount direto do banco, sem passar pelo cache do link (que guarda
  // um snapshot que não é refrescado pelos flushes periódicos de clique).
  async getPersistedClickCount(linkId: string): Promise<number> {
    const link = await this.prisma.link.findUnique({
      where: { id: linkId },
      select: { clickCount: true },
    });
    return link?.clickCount ?? 0;
  }
}
