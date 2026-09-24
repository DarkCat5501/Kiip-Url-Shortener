import { Controller, Get, Param } from '@nestjs/common';
import { StatsService } from './stats.service.js';

@Controller('links/:slug/stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  async getStats(@Param('slug') slug: string) {
    return this.statsService.getStats(slug);
  }
}