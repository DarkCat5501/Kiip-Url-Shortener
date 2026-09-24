import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { LinksService, isEffectivelyActive } from '../links/links.service.js';

@Injectable()
export class StatsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private linksService: LinksService,
  ) {}

  async getStats(slug: string) {
    const cacheKey = `stats:${slug}`;
    const cached = await this.redis.get<any>(cacheKey);
    if (cached) return cached;

    // findBySlug passa pelo cache L1/L2 antes do banco — necessário porque um
    // link recém-criado pode ainda estar só no buffer de escrita em lote,
    // sem ter sido persistido no Postgres (o flush roda a cada 2s ou 20 itens).
    const link = await this.linksService.findBySlug(slug);

    if (!link) {
      throw new NotFoundException(`Link with slug '${slug}' not found`);
    }

    const [persistedCount, pendingDelta, dailyStats, recentAccesses] = await Promise.all([
      this.linksService.getPersistedClickCount(link.id),
      this.redis.getCounter(`clicks:${link.id}`),
      this.getDailyStats(link.id),
      this.getRecentAccesses(link.id),
    ]);

    const totalClicks = persistedCount + pendingDelta;

    const result = {
      slug: link.slug,
      url: link.url,
      active: isEffectivelyActive(link),
      createdAt: link.createdAt,
      totalClicks,
      dailyStats,
      recentAccesses,
    };

    // Cache for 5s: protege contra rajadas de leitura no mesmo link sem deixar
    // a tela de stats visivelmente desatualizada por muito tempo
    await this.redis.set(cacheKey, result, 5);

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