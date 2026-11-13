import { json, readJson } from '../_core/http.js';
import { LinksService } from './links.service.js';
import { parseCreateLinkDto } from './dto/create-link.dto.js';
import { parseUpdateLinkDto } from './dto/update-link.dto.js';
import { parseQueryLinksDto } from './dto/query-links.dto.js';

export namespace LinksController {
  export async function create(req: Request) {
    const dto = parseCreateLinkDto(await readJson(req));
    return json(await LinksService.create(dto), 201);
  }

  export async function findAll(req: Request) {
    const query = parseQueryLinksDto(new URL(req.url).searchParams);
    return json(await LinksService.findAll(query));
  }

  export async function findOne(req: Bun.BunRequest<'/links/:slug'>) {
    return json(await LinksService.findOne(req.params.slug));
  }

  export async function setActive(req: Bun.BunRequest<'/links/:slug'>) {
    const dto = parseUpdateLinkDto(await readJson(req));
    const { slug } = req.params;
    return json(dto.active ? await LinksService.reactivate(slug) : await LinksService.deactivate(slug));
  }
}
