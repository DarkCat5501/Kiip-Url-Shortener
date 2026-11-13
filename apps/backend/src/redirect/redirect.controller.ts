import { HttpError } from '../_core/http.js';
import { RedirectService, RedirectStatus } from './redirect.service.js';

export namespace RedirectController {
  export async function redirect(req: Bun.BunRequest<'/:slug'>, server: Bun.Server<undefined>) {
    const result = await RedirectService.processRedirect(req.params.slug, {
      referer: req.headers.get('referer') ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
      ip: server.requestIP(req)?.address,
    });

    if (!result) {
      throw new HttpError(404, 'Link not found');
    }

    if (result.status === RedirectStatus.GONE) {
      throw new HttpError(410, 'Link is no longer active');
    }

    return new Response(null, { status: 302, headers: { Location: result.url } });
  }
}
