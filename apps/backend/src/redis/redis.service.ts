import { RedisClient } from 'bun';
import { getNumber, getString } from '../_core/config.js';

// O client nativo do Bun faz auto-pipelining: comandos emitidos no mesmo tick
// seguem juntos pela mesma conexão, então não precisa de pool.
export namespace RedisService {
  const client = new RedisClient(`redis://${getString('REDIS_HOST', 'localhost')}:${getNumber('REDIS_PORT', 6379)}`);

  export async function shutdown(): Promise<void> {
    client.close();
  }

  export async function get<T>(key: string): Promise<T | null> {
    const data = await client.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  }

  export async function set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await client.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await client.set(key, serialized);
    }
  }

  export async function del(key: string): Promise<void> {
    await client.del(key);
  }

  // Deletes all keys matching a glob pattern via non-blocking SCAN cursor
  export async function delByPattern(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [nextCursor, keys] = (await client.send('SCAN', [cursor, 'MATCH', pattern, 'COUNT', '500'])) as [string, string[]];
      cursor = nextCursor;
      if (keys.length > 0) {
        await client.send('DEL', keys);
      }
    } while (cursor !== '0');
  }

  // Atomic counter operations (stored as raw strings, not JSON)
  export async function incrby(key: string, delta: number): Promise<number> {
    return client.incrby(key, delta);
  }

  export async function getCounter(key: string): Promise<number> {
    const value = await client.get(key);
    return value ? Number(value) : 0;
  }

  export async function getCounters(keys: string[]): Promise<number[]> {
    if (keys.length === 0) return [];
    const values = (await client.send('MGET', keys)) as Array<string | null>;
    return values.map((v) => (v ? Number(v) : 0));
  }

  // List operations for buffering. `values` is capped by callers (max 1000/batch)
  // to stay well under JS engine argument-spread limits.
  export async function lpush(key: string, values: string[]): Promise<number> {
    return (await client.send('LPUSH', [key, ...values])) as number;
  }

  // Read and remove up to `limit` items from the list in a single roundtrip
  export async function lpopall<T>(key: string, limit = 1000): Promise<T[]> {
    const items = (await client.send('LPOP', [key, String(limit)])) as string[] | null;
    if (!items) return [];
    return items.map((item) => JSON.parse(item));
  }

  // Empilha os logs e soma os deltas dos contadores pendentes; os comandos vão
  // juntos via auto-pipelining. Retorna o tamanho do buffer após o push.
  export async function pushBatch(
    listKey: string,
    values: string[],
    counterDeltas: Map<string, number>,
    counterTtlSeconds: number,
  ): Promise<number> {
    const commands: Promise<unknown>[] = [client.send('LPUSH', [listKey, ...values])];
    for (const [key, delta] of counterDeltas) {
      commands.push(client.incrby(key, delta), client.expire(key, counterTtlSeconds));
    }

    const [length] = await Promise.all(commands);
    return length as number;
  }
}
