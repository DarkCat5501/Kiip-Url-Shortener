import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { HttpError } from '../_core/http.js';

// sql é usado como template tag (consulta, consome o próximo resultado da
// fila) e como helper de fragmento (sql(rows, ...cols), não consome).
const queryResults: unknown[] = [];
const sqlMock = mock((first: unknown, ..._rest: unknown[]) => {
  const isTemplate = Array.isArray(first) && 'raw' in first;
  return isTemplate ? Promise.resolve(queryResults.shift() ?? []) : first;
});
const queueQuery = (rows: unknown[]) => queryResults.push(rows);

const mockRedis = {
  get: mock(async (_key: string): Promise<unknown> => null),
  set: mock(async () => {}),
  del: mock(async () => {}),
  incrby: mock(async () => 0),
  rpush: mock(async () => 0),
  requeue: mock(async () => 0),
  lpopall: mock(async () => []),
  getCounter: mock(async () => 0),
  getCounters: mock(async () => []),
};

mock.module('../postgres/postgres.service.js', () => ({ PostgresService: { sql: sqlMock } }));
mock.module('../redis/redis.service.js', () => ({ RedisService: mockRedis }));

const { LinksService } = await import('./links.service.js');

const linkRow = (overrides: Record<string, unknown> = {}) => ({
  id: '123',
  slug: 'abc',
  url: 'https://example.com',
  active: true,
  expires_at: null,
  max_clicks: null,
  click_count: 0,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

describe('LinksService', () => {
  beforeEach(() => {
    queryResults.length = 0;
    sqlMock.mockClear();
    mockRedis.get.mockReset().mockResolvedValue(null);
    mockRedis.set.mockClear();
    mockRedis.del.mockClear();
    mockRedis.getCounter.mockReset().mockResolvedValue(0);
  });

  describe('create', () => {
    it('should create a link with auto-generated slug and buffer it', async () => {
      const result = await LinksService.create({ url: 'https://example.com' });

      expect(result).toHaveProperty('shortUrl');
      expect(result.url).toBe('https://example.com');
      expect(result.slug).toHaveLength(7);
      expect(mockRedis.set).toHaveBeenCalled();
      expect(mockRedis.rpush).toHaveBeenCalled();
    });

    it('should create a link with custom slug', async () => {
      queueQuery([]);

      const result = await LinksService.create({ url: 'https://example.com', slug: 'custom' });

      expect(result.slug).toBe('custom');
    });

    it('should throw HttpError(409) if custom slug already exists', async () => {
      queueQuery([{ id: '999' }]);

      await expect(LinksService.create({ url: 'https://example.com', slug: 'taken' })).rejects.toMatchObject({
        status: 409,
      });
    });
  });

  describe('findOne', () => {
    it('should return a link with click count', async () => {
      queueQuery([linkRow({ click_count: 40 })]);
      mockRedis.getCounter.mockResolvedValue(2);

      const result = await LinksService.findOne('abc');

      expect(result.clickCount).toBe(42);
      expect(result.url).toBe('https://example.com');
      expect(result).not.toHaveProperty('id');
    });

    it('should throw HttpError(404) if link not found', async () => {
      queueQuery([]);

      await expect(LinksService.findOne('nonexistent')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('deactivate', () => {
    it('should deactivate a link and clear cache', async () => {
      queueQuery([linkRow()]); // findBySlug
      queueQuery([{ slug: 'abc' }]); // existência antes do update
      queueQuery([linkRow({ active: false })]); // update

      const result = await LinksService.deactivate('abc');

      expect(result.active).toBe(false);
      expect(mockRedis.del).toHaveBeenCalledWith('l:abc');
    });

    it('should throw HttpError(404) if link not found', async () => {
      queueQuery([]);

      await expect(LinksService.deactivate('nonexistent')).rejects.toBeInstanceOf(HttpError);
    });
  });

  describe('findBySlug', () => {
    it('should return cached link if available', async () => {
      const cachedLink = { slug: 'abc', url: 'https://example.com' };
      mockRedis.get.mockResolvedValue(cachedLink);

      const result = await LinksService.findBySlug('abc');

      expect(result).toEqual(cachedLink as any);
      expect(sqlMock).not.toHaveBeenCalled();
    });

    it('should fetch from database and cache if not in cache (without id)', async () => {
      queueQuery([linkRow({ slug: 'xyz' })]);

      const result = await LinksService.findBySlug('xyz');

      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('id');
      expect(mockRedis.set).toHaveBeenCalledWith('l:xyz', result, 3600);
    });

    it('should return null if link not found anywhere', async () => {
      queueQuery([]);

      const result = await LinksService.findBySlug('nonexistent');

      expect(result).toBeNull();
    });
  });
});
