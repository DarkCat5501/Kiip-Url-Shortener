import { Controller, Get, Param, Res, NotFoundException, GoneException } from '@nestjs/common';
import type { Response } from 'express';
import { RedirectService, RedirectStatus } from './redirect.service.js';

@Controller()
export class RedirectController {
  constructor(private readonly redirectService: RedirectService) {}

  @Get(':slug')
  async redirect(@Param('slug') slug: string, @Res() res: Response) {
    const result = await this.redirectService.processRedirect(slug, res);

    if (!result) {
      throw new NotFoundException('Link not found');
    }

    if (result.status === RedirectStatus.GONE) {
      throw new GoneException('Link is no longer active');
    }

    res.redirect(302, result.url);
  }
}
