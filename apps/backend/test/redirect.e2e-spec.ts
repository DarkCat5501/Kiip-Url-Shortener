import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

describe('Redirect Flow (e2e)', () => {
  let app: INestApplication<App>;
  let createdSlug: string;
  // Slug único por execução (máx. 10 caracteres): evita colisão com dados de
  // rodadas anteriores (o banco de teste não é limpo entre execuções)
  const customSlug = `e2e${Date.now().toString(36)}`.slice(0, 10);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /links', () => {
    it('should create a shortened link', async () => {
      const response = await request(app.getHttpServer())
        .post('/links')
        .send({ url: 'https://example.com' })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('slug');
      expect(response.body).toHaveProperty('shortUrl');
      expect(response.body.url).toBe('https://example.com');
      expect(response.body.active).toBe(true);

      createdSlug = response.body.slug;
    });

    it('should create a link with custom slug', async () => {
      const response = await request(app.getHttpServer())
        .post('/links')
        .send({ url: 'https://example.com', slug: customSlug })
        .expect(201);

      expect(response.body.slug).toBe(customSlug);
    });

    it('should reject invalid URL', async () => {
      await request(app.getHttpServer())
        .post('/links')
        .send({ url: 'not-a-url' })
        .expect(400);
    });

    it('should reject duplicate slug', async () => {
      await request(app.getHttpServer())
        .post('/links')
        .send({ url: 'https://example.com', slug: customSlug })
        .expect(409);
    });
  });

  describe('GET /:slug', () => {
    it('should redirect to the original URL', async () => {
      const response = await request(app.getHttpServer())
        .get(`/${createdSlug}`)
        .expect(302);

      expect(response.headers.location).toBe('https://example.com');
    });

    it('should return 404 for non-existent slug', async () => {
      await request(app.getHttpServer())
        .get('/nonexistent')
        .expect(404);
    });
  });

  describe('GET /links/:slug/stats', () => {
    it('should return link statistics', async () => {
      const response = await request(app.getHttpServer())
        .get(`/links/${createdSlug}/stats`)
        .expect(200);

      expect(response.body).toHaveProperty('totalClicks');
      expect(response.body).toHaveProperty('dailyStats');
      expect(response.body).toHaveProperty('recentAccesses');
      expect(response.body.slug).toBe(createdSlug);
      expect(response.body.url).toBe('https://example.com');
    });

    it('should return 404 for non-existent link stats', async () => {
      await request(app.getHttpServer())
        .get('/links/nonexistent/stats')
        .expect(404);
    });
  });

  describe('PATCH /links/:slug', () => {
    it('should deactivate a link', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/links/${createdSlug}`)
        .send({ active: false })
        .expect(200);

      expect(response.body.active).toBe(false);
    });

    it('should return 410 Gone for deactivated link', async () => {
      await request(app.getHttpServer())
        .get(`/${createdSlug}`)
        .expect(410);
    });
  });
});