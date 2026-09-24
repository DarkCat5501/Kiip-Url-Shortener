import { Injectable, ConflictException, NotFoundException, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { nanoid } from 'nanoid';
import type { Link } from '@prisma/client';

@Injectable()
export class LinksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LinksService.name);
  private linkBuffer: Array<{
    id: string;
    slug: string;
    url: string;
    expiresAt: Date | null;
    maxClicks: number | null;
  }> = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  onModuleInit() {
    this.flushInterval = setInterval(() => {
      this.flushLinks().catch((err) => this.logger.error('Failed to flush links', err));
    }, 5000);
  }

  onModuleDestroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flushLinks().catch((err) => this.logger.error('Failed to flush links on shutdown', err));
  }

  private async flushLinks() {
    if (this.linkBuffer.length === 0) return;

    const links = [...this.linkBuffer];
    this.linkBuffer = [];

    try {
      // Batch insert com Prisma createMany
      await this.prisma.link.createMany({
        data: links.map((l) => ({
          id: l.id,
          slug: l.slug,
          url: l.url,
          expiresAt: l.expiresAt,
          maxClicks: l.maxClicks,
        })),
        skipDuplicates: true, // ignora slugs duplicados
      });
      this.logger.debug(`Flushed ${links.length} links to database`);
    } catch (err) {
      this.logger.error('Failed to write links to database', err);
      // Re-adiciona ao buffer para retry
      this.linkBuffer.push(...links);
    }
  }

  async create(dto: CreateLinkDto): Promise<Link & { shortUrl: string }> {
    const slug = dto.slug || nanoid(7);

    // Verifica unicidade no Redis (mais rápido que banco)
    if (dto.slug) {
      const cached = await this.redis.get(`link:${dto.slug}`);
      if (cached) {
        throw new ConflictException(`Slug '${dto.slug}' already exists`);
      }
      // Também verifica no banco para garantir
      const existing = await this.prisma.link.findUnique({ where: { slug: dto.slug } });
      if (existing) {
        throw new ConflictException(`Slug '${dto.slug}' already exists`);
      }
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
      createdAt: now,
      updatedAt: now,
    };

    // Cacheia no Redis imediatamente (redirect funciona)
    await this.redis.set(`link:${slug}`, linkData, 3600);

    // Adiciona ao buffer para batch insert no banco
    this.linkBuffer.push({
      id,
      slug,
      url: dto.url,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      maxClicks: dto.maxClicks ?? null,
    });

    // Flush imediato se buffer grande
    if (this.linkBuffer.length >= 100) {
      this.flushLinks().catch((err) => this.logger.error('Failed to flush links', err));
    }

    return {
      ...linkData,
      shortUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/${slug}`,
    };
  }

  async findAll() {
    const links = await this.prisma.link.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { accesses: true } },
      },
    });

    return links.map((link) => ({
      ...link,
      clickCount: link._count.accesses,
      _count: undefined,
    }));
  }

  async findOne(slug: string) {
    const link = await this.prisma.link.findUnique({
      where: { slug },
      include: {
        _count: { select: { accesses: true } },
      },
    });

    if (!link) {
      throw new NotFoundException(`Link with slug '${slug}' not found`);
    }

    return {
      ...link,
      clickCount: link._count.accesses,
      _count: undefined,
    };
  }

  async deactivate(slug: string): Promise<Link> {
    const link = await this.prisma.link.findUnique({ where: { slug } });

    if (!link) {
      throw new NotFoundException(`Link with slug '${slug}' not found`);
    }

    const updated = await this.prisma.link.update({
      where: { slug },
      data: { active: false },
    });

    await this.redis.del(`link:${slug}`);

    return updated;
  }

  async findBySlug(slug: string): Promise<Link | null> {
    const cached = await this.redis.get<Link>(`link:${slug}`);
    if (cached) return cached;

    const link = await this.prisma.link.findUnique({ where: { slug } });
    if (link) {
      await this.redis.set(`link:${slug}`, link, 3600);
    }

    return link;
  }
}