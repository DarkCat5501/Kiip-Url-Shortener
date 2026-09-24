import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { nanoid } from 'nanoid';
import type { Link } from '@prisma/client';

@Injectable()
export class LinksService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async create(dto: CreateLinkDto): Promise<Link & { shortUrl: string }> {
    const slug = dto.slug || nanoid(7);

    if (dto.slug) {
      const existing = await this.prisma.link.findUnique({ where: { slug: dto.slug } });
      if (existing) {
        throw new ConflictException(`Slug '${dto.slug}' already exists`);
      }
    }

    const link = await this.prisma.link.create({
      data: {
        slug,
        url: dto.url,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        maxClicks: dto.maxClicks ?? null,
      },
    });

    await this.redis.set(`link:${slug}`, link, 3600);

    return {
      ...link,
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