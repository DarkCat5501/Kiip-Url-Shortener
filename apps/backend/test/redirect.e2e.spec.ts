import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { postJson, startApp } from './support.js';

describe('Redirect Flow (e2e)', () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  let createdSlug: string;
  // Slug único por execução (máx. 10 caracteres): evita colisão com dados de
  // rodadas anteriores (o banco de teste não é limpo entre execuções)
  const customSlug = `e2e${Date.now().toString(36)}`.slice(0, 10);

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /links', () => {
    it('should create a shortened link', async () => {
      const response = await postJson(`${app.url}/links`, { url: 'https://example.com' });
      const body: any = await response.json();

      expect(response.status).toBe(201);
      expect(body).toHaveProperty('slug');
      expect(body).toHaveProperty('shortUrl');
      expect(body.url).toBe('https://example.com');
      expect(body.active).toBe(true);

      createdSlug = body.slug;
    });

    it('should create a link with custom slug', async () => {
      const response = await postJson(`${app.url}/links`, { url: 'https://example.com', slug: customSlug });

      expect(response.status).toBe(201);
      expect(((await response.json()) as any).slug).toBe(customSlug);
    });

    it('should reject invalid URL', async () => {
      const response = await postJson(`${app.url}/links`, { url: 'not-a-url' });

      expect(response.status).toBe(400);
    });

    it('should reject duplicate slug', async () => {
      const response = await postJson(`${app.url}/links`, { url: 'https://example.com', slug: customSlug });

      expect(response.status).toBe(409);
    });
  });

  describe('GET /:slug', () => {
    it('should redirect to the original URL', async () => {
      const response = await fetch(`${app.url}/${createdSlug}`, { redirect: 'manual' });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://example.com');
    });

    it('should return 404 for non-existent slug', async () => {
      const response = await fetch(`${app.url}/nonexistent`);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /links/:slug/stats', () => {
    it('should return link statistics', async () => {
      const response = await fetch(`${app.url}/links/${createdSlug}/stats`);
      const body: any = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveProperty('totalClicks');
      expect(body).toHaveProperty('dailyStats');
      expect(body).toHaveProperty('recentAccesses');
      expect(body.slug).toBe(createdSlug);
      expect(body.url).toBe('https://example.com');
    });

    it('should return 404 for non-existent link stats', async () => {
      const response = await fetch(`${app.url}/links/nonexistent/stats`);

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /links/:slug', () => {
    it('should deactivate a link', async () => {
      const response = await postJson(`${app.url}/links/${createdSlug}`, { active: false }, 'PATCH');

      expect(response.status).toBe(200);
      expect(((await response.json()) as any).active).toBe(false);
    });

    it('should return 410 Gone for deactivated link', async () => {
      const response = await fetch(`${app.url}/${createdSlug}`, { redirect: 'manual' });

      expect(response.status).toBe(410);
    });
  });
});
