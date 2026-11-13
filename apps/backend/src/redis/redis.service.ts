import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// ioredis não tem pool nativo: um único client usa uma única conexão TCP, e sob
// alta concorrência todos os comandos ficam enfileirados nela (medido: um GET
// que leva 0.3ms sem carga sobe a 250ms+ sob 1000 conexões HTTP concorrentes).
// Múltiplos clients em round-robin dão paralelismo real de I/O ao Redis.
const POOL_SIZE = 8;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private pool: Redis[] = [];
  private nextClientIndex = 0;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('REDIS_HOST', 'localhost');
    const port = this.config.get<number>('REDIS_PORT', 6379);

    this.pool = Array.from({ length: POOL_SIZE }, () => {
      const client = new Redis({ host, port, lazyConnect: true });
      // Sem isso, um evento 'error' sem listener derruba o processo inteiro
      // (comportamento padrão do EventEmitter do Node para eventos de erro)
      client.on('error', (err) => console.error('[redis]', err.message));
      return client;
    });
  }

  private get client(): Redis {
    const client = this.pool[this.nextClientIndex];
    this.nextClientIndex = (this.nextClientIndex + 1) % this.pool.length;
    return client;
  }

  async onModuleDestroy() {
    await Promise.all(this.pool.map((client) => client.quit()));
  }

  async get<T>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, serialized);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  // Deletes all keys matching a glob pattern via non-blocking SCAN cursor
  async delByPattern(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } while (cursor !== '0');
  }

  // Atomic counter operations (stored as raw strings, not JSON)
  async incrby(key: string, delta: number): Promise<number> {
    return this.client.incrby(key, delta);
  }

  async getCounter(key: string): Promise<number> {
    const value = await this.client.get(key);
    return value ? Number(value) : 0;
  }

  async getCounters(keys: string[]): Promise<number[]> {
    if (keys.length === 0) return [];
    const values = await this.client.mget(keys);
    return values.map((v) => (v ? Number(v) : 0));
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  // List operations for buffering. `values` is capped by callers (max 1000/batch)
  // to stay well under JS engine argument-spread limits.
  async lpush(key: string, values: string[]): Promise<number> {
    if (values.length === 0) return this.client.llen(key);
    return this.client.lpush(key, ...values);
  }

  // Um único round-trip para o lote: empilha os logs e soma os deltas dos
  // contadores pendentes. Retorna o tamanho do buffer após o push.
  async pushBatch(
    listKey: string,
    values: string[],
    counterDeltas: Map<string, number>,
    counterTtlSeconds: number,
  ): Promise<number> {
    const pipeline = this.client.pipeline().lpush(listKey, ...values);
    for (const [key, delta] of counterDeltas) {
      pipeline.incrby(key, delta).expire(key, counterTtlSeconds);
    }

    const results = await pipeline.exec();
    for (const [err] of results!) {
      if (err) throw err;
    }
    return results![0][1] as number;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    await this.client.ltrim(key, start, stop);
  }

  async llen(key: string): Promise<number> {
    return this.client.llen(key);
  }

  // Read and remove up to `limit` items from the list in a single roundtrip
  async lpopall<T>(key: string, limit = 1000): Promise<T[]> {
    const items = await this.client.lpop(key, limit);
    if (!items) return [];
    return items.map((item) => JSON.parse(item));
  }
}