import { createServer } from './app.js';
import { PostgresService } from './postgres/postgres.service.js';
import { RedisService } from './redis/redis.service.js';
import { LinksService } from './links/links.service.js';
import { RedirectService } from './redirect/redirect.service.js';

await PostgresService.migrate();
await LinksService.init();
await RedirectService.init();

const server = createServer(process.env.PORT ?? 3000);
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
