import { Controller, Post, Get, Body, Param, Patch, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LinksService } from './links.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';

@Controller('links')
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Post()
  // @Throttle({ default: { limit: 30, ttl: 60000 } }) // Desabilitado para stress test
  async create(@Body() dto: CreateLinkDto) {
    return this.linksService.create(dto);
  }

  @Get()
  async findAll() {
    return this.linksService.findAll();
  }

  @Get(':slug')
  async findOne(@Param('slug') slug: string) {
    return this.linksService.findOne(slug);
  }

  @Patch(':slug')
  async deactivate(@Param('slug') slug: string) {
    return this.linksService.deactivate(slug);
  }
}