import { Module } from '@nestjs/common';
import { LinksModule } from '../links/links.module.js';
import { StatsController } from './stats.controller.js';
import { StatsService } from './stats.service.js';

@Module({
  imports: [LinksModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}