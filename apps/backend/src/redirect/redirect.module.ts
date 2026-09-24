import { Module } from '@nestjs/common';
import { RedirectController } from './redirect.controller.js';
import { RedirectService } from './redirect.service.js';
import { LinksModule } from '../links/links.module.js';

@Module({
  imports: [LinksModule],
  controllers: [RedirectController],
  providers: [RedirectService],
})
export class RedirectModule {}