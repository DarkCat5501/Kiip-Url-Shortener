import { createServer } from './app.js';
import { getNumber } from './_core/config.js';
import { PostgresService } from './postgres/postgres.service.js';
import { RedisService } from './redis/redis.service.js';
import { LinksService } from './links/links.service.js';
import { RedirectService } from './redirect/redirect.service.js';

const workers = getNumber('WORKERS', 1);
const isWorker = process.env.WORKER_ID !== undefined;

// O JS roda em uma thread só: com WORKERS > 1 o processo principal aplica o
// schema, sobe N cópias de si mesmo (reusePort distribui as conexões entre
// elas) e repassa o sinal de desligamento.
async function runPrimary() {
  await PostgresService.migrate();
  await PostgresService.close();

  const children = Array.from({ length: workers }, (_, i) =>
    Bun.spawn([process.execPath, Bun.main], {
      env: { ...process.env, WORKER_ID: String(i + 1) },
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  );

  const stop = () => children.forEach((child) => child.kill('SIGTERM'));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  await Promise.all(children.map((child) => child.exited));
  process.exit(0);
}

async function runServer() {
  if (!isWorker) await PostgresService.migrate();
  await LinksService.init();
  await RedirectService.init();

  const server = createServer(process.env.PORT ?? 3000, { reusePort: workers > 1 });
  console.log(`🚀 Application running on port ${server.port}`);

  // Sem isso, SIGTERM (enviado pelo Cloud Run/K8s antes de desligar uma
  // instância) nunca flusha os buffers de links/access logs pendentes — ficariam
  // presos no Redis até outra instância flushar
  async function shutdown() {
    await server.stop();
    await RedirectService.shutdown();
    await LinksService.shutdown();
    await RedisService.shutdown();
    await PostgresService.close();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (workers > 1 && !isWorker) await runPrimary();
else await runServer();
