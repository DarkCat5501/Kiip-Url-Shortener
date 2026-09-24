import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { LinksService } from '../links/links.service.js';

export enum RedirectStatus {
  OK = 'ok',
  GONE = 'gone',
}

interface RedirectResult {
  url: string;
  status: RedirectStatus;
}

@Injectable()
export class RedirectService {
  private readonly logger = new Logger(RedirectService.name);
  private accessLogBuffer: Array<{
    linkId: string;
    referer?: string;
    userAgent?: string;
    ip?: string;
  }> = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private linksService: LinksService,
  ) {
    this.startFlushInterval();
  }

  private startFlushInterval() {
    this.flushInterval = setInterval(() => {
      this.flushLogs().catch((err) => this.logger.error('Failed to flush logs', err));
    }, 5000);
  }

  async onModuleDestroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flushLogs();
  }

  private async flushLogs() {
    if (this.accessLogBuffer.length === 0) return;

    const logs = [...this.accessLogBuffer];
    this.accessLogBuffer = [];

    try {
      await this.prisma.accessLog.createMany({
        data: logs,
      });
    } catch (err) {
      this.logger.error('Failed to write access logs', err);
      this.accessLogBuffer.push(...logs);
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
      await this.redis.del(`link:${slug}`);
      return { url: '', status: RedirectStatus.GONE };
    }

    if (link.maxClicks) {
      const clickCount = await this.prisma.accessLog.count({
        where: { linkId: link.id },
      });

      if (clickCount >= link.maxClicks) {
        await this.redis.del(`link:${slug}`);
        return { url: '', status: RedirectStatus.GONE };
      }
    }

    this.logAccessAsync(link.id, res.req.headers.referer, res.req.headers['user-agent'], res.req.ip);

    return { url: link.url, status: RedirectStatus.OK };
  }

  private logAccessAsync(linkId: string, referer?: string, userAgent?: string | string[], ip?: string) {
    this.accessLogBuffer.push({
      linkId,
      referer: referer || undefined,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      ip,
    });

    if (this.accessLogBuffer.length >= 100) {
      this.flushLogs().catch((err) => this.logger.error('Failed to flush logs', err));
    }
  }
}