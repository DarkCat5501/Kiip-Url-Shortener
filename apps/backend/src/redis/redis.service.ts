import { RedisClient } from 'bun';
import { getNumber, getString } from '../_core/config.js';

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

  // Soma vários deltas em um único comando (EVAL): KEYS[i] += ARGV[i].
  const INCRBY_MANY_SCRIPT = `
    for i = 1, #KEYS do
      redis.call('INCRBY', KEYS[i], ARGV[i])
    end
  `;

  export async function incrbyMany(deltas: Map<string, number>): Promise<void> {
    if (deltas.size === 0) return;
    const keys = [...deltas.keys()];
    const args = [...deltas.values()].map(String);
    await client.send('EVAL', [INCRBY_MANY_SCRIPT, String(keys.length), ...keys, ...args]);
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

  // Filas de buffer: produtores usam RPUSH (cauda) e o consumidor LPOP (cabeça),
  // então a ordem é FIFO. `values` é limitado pelos chamadores (máx. 1000/lote)
  // para ficar bem abaixo do limite de argumentos.
  export async function rpush(key: string, values: string[]): Promise<number> {
    return (await client.send('RPUSH', [key, ...values])) as number;
  }

  // Devolve itens que falharam à cabeça da fila, mantendo a ordem original
  // (LPUSH insere um a um, então o lote vai invertido).
  export async function requeue(key: string, values: string[]): Promise<number> {
    return (await client.send('LPUSH', [key, ...values.toReversed()])) as number;
  }

  // Read and remove up to `limit` items from the list in a single roundtrip
  export async function lpopall<T>(key: string, limit = 1000): Promise<T[]> {
    const items = (await client.send('LPOP', [key, String(limit)])) as string[] | null;
    if (!items) return [];
    return items.map((item) => JSON.parse(item));
  }

  // KEYS[1] = lista; KEYS[2..] = contadores; ARGV[1] = ttl; ARGV[2..n+1] = deltas
  // (n = #KEYS - 1); o restante de ARGV são os valores do RPUSH.
  const PUSH_BATCH_SCRIPT = `
    local n = #KEYS - 1
    for i = 1, n do
      redis.call('INCRBY', KEYS[i + 1], ARGV[i + 1])
      redis.call('EXPIRE', KEYS[i + 1], ARGV[1])
    end
    return redis.call('RPUSH', KEYS[1], unpack(ARGV, n + 2))
  `;

  // Um único comando (EVAL) por lote: enfileira os logs (RPUSH) e soma os deltas dos
  // contadores pendentes de forma atômica. Retorna o tamanho do buffer.
  export async function pushBatch(
    listKey: string,
    values: string[],
    counterDeltas: Map<string, number>,
    counterTtlSeconds: number,
  ): Promise<number> {
    const keys = [listKey, ...counterDeltas.keys()];
    const args = [String(counterTtlSeconds), ...[...counterDeltas.values()].map(String), ...values];

    return (await client.send('EVAL', [PUSH_BATCH_SCRIPT, String(keys.length), ...keys, ...args])) as number;
  }
}
