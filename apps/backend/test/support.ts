import { createServer } from '../src/app.js';
import { PostgresService } from '../src/postgres/postgres.service.js';
import { LinksService } from '../src/links/links.service.js';
import { RedirectService } from '../src/redirect/redirect.service.js';

export async function startApp() {
  await PostgresService.migrate();
  await LinksService.init();
  await RedirectService.init();

  const server = createServer(0);

  // Postgres/Redis ficam abertos: os arquivos de teste compartilham o processo
  // (e os singletons dos namespaces), então fechar num arquivo quebra o próximo.
  return {
    url: server.url.origin,
    async close() {
      await server.stop();
      await RedirectService.shutdown();
      await LinksService.shutdown();
    },
  };
}

export function postJson(url: string, body: unknown, method = 'POST') {
  return fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
