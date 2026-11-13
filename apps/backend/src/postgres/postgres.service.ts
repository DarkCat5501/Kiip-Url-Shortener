import { SQL } from 'bun';
import schema from '../../db/schema.sql' with { type: 'text' };
import { getNumber, getString } from '../_core/config.js';

export namespace PostgresService {
  // connection_limit/pool_timeout/schema são parâmetros da DATABASE_URL no
  // formato do Prisma (ver .env.example); o Postgres rejeitaria como GUCs
  // desconhecidos, então saem da URL e connection_limit vira o tamanho do pool.
  const url = new URL(getString('DATABASE_URL', 'postgresql://localhost:5432/postgres'));
  // O limite é dividido entre os workers (ver WORKERS em main.ts).
  const max = Math.max(1, Math.floor(Number(url.searchParams.get('connection_limit') ?? 10) / getNumber('WORKERS', 1)));
  for (const param of ['connection_limit', 'pool_timeout', 'schema']) {
    url.searchParams.delete(param);
  }

  export const sql = new SQL({ url: url.toString(), max });

  export async function migrate(): Promise<void> {
    await sql.unsafe(schema);
  }

  export async function close(): Promise<void> {
    await sql.close();
  }
}
