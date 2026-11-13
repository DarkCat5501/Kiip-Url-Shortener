import { PostgresService } from '../postgres/postgres.service.js';
import { RedisService } from '../redis/redis.service.js';
import { LinksService, isEffectivelyActive } from '../links/links.service.js';
import { HttpError } from '../_core/http.js';
import { REDIS_CLICK_COUNT_KEY } from '../_core/constants.js';

const sql = PostgresService.sql;

export namespace StatsService {
  export async function getStats(slug: string) {
    const cacheKey = `stats:${slug}`;
    const cached = await RedisService.get<any>(cacheKey);
    if (cached) return cached;

    // findBySlug passa pelo cache L1/L2 antes do banco — necessário porque um
    // link recém-criado pode ainda estar só no buffer de escrita em lote,
    // sem ter sido persistido no Postgres (o flush roda a cada 2s ou 20 itens).
    const link = await LinksService.findBySlug(slug);

    if (!link) {
      throw new HttpError(404, `Link with slug '${slug}' not found`);
    }

    // Resolve o id real do banco: o cache do link pode não ter id se ele
    // ainda não foi persistido pelo flush do buffer de criação.
    const linkId = await LinksService.getPersistedId(slug);

    const [persistedCount, pendingDelta, dailyStats, recentAccesses] = await Promise.all([
      LinksService.getPersistedClickCount(slug),
      RedisService.getCounter(REDIS_CLICK_COUNT_KEY(slug)),
      linkId !== null ? getDailyStats(linkId) : Promise.resolve([]),
      linkId !== null ? getRecentAccesses(linkId) : Promise.resolve([]),
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
    await RedisService.set(cacheKey, result, 5);

    return result;
  }

  async function getDailyStats(linkId: string) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const raw = await sql<Array<{ date: Date; count: string }>>`
      SELECT
        DATE(accessed_at) AS date,
        COUNT(*) AS count
      FROM access_logs
      WHERE link_id = ${linkId}
        AND accessed_at >= ${sevenDaysAgo}
      GROUP BY DATE(accessed_at)
      ORDER BY date DESC
    `;

    return raw.map((row) => ({
      date: row.date,
      count: Number(row.count),
    }));
  }

  async function getRecentAccesses(linkId: string) {
    const rows = await sql<Array<{ accessed_at: Date; referer: string | null; user_agent: string | null }>>`
      SELECT accessed_at, referer, user_agent
      FROM access_logs
      WHERE link_id = ${linkId}
      ORDER BY accessed_at DESC
      LIMIT 20
    `;

    return rows.map((row) => ({
      accessedAt: row.accessed_at,
      referer: row.referer,
      userAgent: row.user_agent,
    }));
  }
}
