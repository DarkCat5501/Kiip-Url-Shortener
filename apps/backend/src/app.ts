import { HttpError } from './_core/http.js';
import { createLogger } from './_core/logger.js';
import { AppController } from './app.controller.js';
import { LinksController } from './links/links.controller.js';
import { RedirectController } from './redirect/redirect.controller.js';
import { StatsController } from './stats/stats.controller.js';

const logger = createLogger('App');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
};

function withCors(res: Response): Response {
  for (const [name, value] of Object.entries(CORS_HEADERS)) res.headers.set(name, value);
  return res;
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return Response.json(err.body, { status: err.status });

  logger.error('Unhandled error', err);
  return Response.json({ statusCode: 500, message: 'Internal server error' }, { status: 500 });
}

type Handler<R> = (req: R, server: Bun.Server<undefined>) => Response | Promise<Response>;

function route<R>(handler: Handler<R>) {
  return async (req: R, server: Bun.Server<undefined>) => {
    try {
      return withCors(await handler(req, server));
    } catch (err) {
      return withCors(errorResponse(err));
    }
  };
}

export function createServer(port: number | string, options: { reusePort?: boolean } = {}) {
  return Bun.serve({
    port,
    reusePort: options.reusePort,
    routes: {
      '/': route(() => new Response(AppController.getHello())),
      '/links': {
        POST: route(LinksController.create),
        GET: route(LinksController.findAll),
      },
      '/links/:slug': {
        GET: route(LinksController.findOne),
        PATCH: route(LinksController.setActive),
      },
      '/links/:slug/stats': { GET: route(StatsController.getStats) },
      '/:slug': { GET: route(RedirectController.redirect) },
    },
    fetch(req) {
      if (req.method === 'OPTIONS') {
        const requested = req.headers.get('access-control-request-headers');
        return withCors(
          new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
              ...(requested ? { 'Access-Control-Allow-Headers': requested } : {}),
            },
          }),
        );
      }

      const { pathname } = new URL(req.url);
      return withCors(
        Response.json(
          { message: `Cannot ${req.method} ${pathname}`, error: 'Not Found', statusCode: 404 },
          { status: 404 },
        ),
      );
    },
  });
}
