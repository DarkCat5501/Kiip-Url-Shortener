import { json } from '../_core/http.js';
import { StatsService } from './stats.service.js';

export namespace StatsController {
  export async function getStats(req: Bun.BunRequest<'/links/:slug/stats'>) {
    return json(await StatsService.getStats(req.params.slug));
  }
}
