import { Controller, Post, Get, Body, Param, Patch, Query, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LinksService } from './links.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { UpdateLinkDto } from './dto/update-link.dto.js';
import { QueryLinksDto } from './dto/query-links.dto.js';

@Controller('links')
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async create(@Body() dto: CreateLinkDto) {
    return this.linksService.create(dto);
  }

  @Get()
  async findAll(@Query() query: QueryLinksDto) {
    return this.linksService.findAll(query);
  }

  @Get(':slug')
  async findOne(@Param('slug') slug: string) {
    return this.linksService.findOne(slug);
  }

  @Patch(':slug')
  async setActive(@Param('slug') slug: string, @Body() dto: UpdateLinkDto) {
    return dto.active
      ? this.linksService.reactivate(slug)
      : this.linksService.deactivate(slug);
  }
}
