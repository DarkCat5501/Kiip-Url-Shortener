import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      // connection_limit e pool_timeout são configurados via query string na
      // própria DATABASE_URL (ver .env.example)
      datasources: {
        db: {
          url: config.get<string>('DATABASE_URL'),
        },
      },
      log: config.get<string>('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}