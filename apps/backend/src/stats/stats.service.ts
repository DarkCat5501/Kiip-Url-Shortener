import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

@Injectable()
export class StatsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async getStats(slug: string) {
    const cacheKey = `stats:${slug}`;
    const cached = await this.redis.get<any>(cacheKey);
    if (cached) return cached;

    const link = await this.prisma.link.findUnique({
      where: { slug },
    });

    if (!link) {
      throw new NotFoundException(`Link with slug '${slug}' not found`);
    }

    const [totalClicks, dailyStats, recentAccesses] = await Promise.all([
      this.prisma.accessLog.count({ where: { linkId: link.id } }),
      this.getDailyStats(link.id),
      this.getRecentAccesses(link.id),
    ]);

    const result = {
      slug: link.slug,
      url: link.url,
      active: link.active,
      createdAt: link.createdAt,
      totalClicks,
      dailyStats,
      recentAccesses,
    };

    await this.redis.set(cacheKey, result, 30);

    return result;
  }

  private async getDailyStats(linkId: string) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const raw = await this.prisma.$queryRaw<
      Array<{ date: Date; count: bigint }>
    >`
      SELECT
        DATE("accessed_at") as date,
        COUNT(*) as count
      FROM "access_logs"
      WHERE "link_id" = ${linkId}::uuid
        AND "accessed_at" >= ${sevenDaysAgo}
      GROUP BY DATE("accessed_at")
      ORDER BY date DESC
    `;

    return raw.map((row) => ({
      date: row.date,
      count: Number(row.count),
    }));
  }

  private async getRecentAccesses(linkId: string) {
    return this.prisma.accessLog.findMany({
      where: { linkId },
      orderBy: { accessedAt: 'desc' },
      take: 20,
      select: {
        accessedAt: true,
        referer: true,
        userAgent: true,
      },
    });
  }
}