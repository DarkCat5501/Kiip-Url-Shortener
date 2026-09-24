import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LinksService } from './links.service.js';
import { ConflictException, NotFoundException } from '@nestjs/common';

// Mock PrismaService
const mockPrisma = {
  link: {
    findUnique: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
};

// Mock RedisService
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

describe('LinksService', () => {
  let service: LinksService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LinksService(mockPrisma as any, mockRedis as any);
  });

  describe('create', () => {
    it('should create a link with auto-generated slug', async () => {
      const dto = { url: 'https://example.com' };
      const mockLink = {
        id: '123',
        slug: 'abc1234',
        url: 'https://example.com',
        active: true,
        expiresAt: null,
        maxClicks: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.link.create.mockResolvedValue(mockLink);

      const result = await service.create(dto);

      expect(result).toHaveProperty('shortUrl');
      expect(result.url).toBe('https://example.com');
      expect(result.slug).toBeDefined();
      expect(mockPrisma.link.create).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('should create a link with custom slug', async () => {
      const dto = { url: 'https://example.com', slug: 'custom' };
      const mockLink = {
        id: '123',
        slug: 'custom',
        url: 'https://example.com',
        active: true,
        expiresAt: null,
        maxClicks: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.link.findUnique.mockResolvedValue(null);
      mockPrisma.link.create.mockResolvedValue(mockLink);

      const result = await service.create(dto);

      expect(result.slug).toBe('custom');
    });

    it('should throw ConflictException if custom slug already exists', async () => {
      const dto = { url: 'https://example.com', slug: 'taken' };

      mockPrisma.link.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findOne', () => {
    it('should return a link with click count', async () => {
      const mockLink = {
        id: '123',
        slug: 'abc',
        url: 'https://example.com',
        active: true,
        _count: { accesses: 42 },
      };

      mockPrisma.link.findUnique.mockResolvedValue(mockLink);

      const result = await service.findOne('abc');

      expect(result.clickCount).toBe(42);
      expect(result.url).toBe('https://example.com');
    });

    it('should throw NotFoundException if link not found', async () => {
      mockPrisma.link.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivate', () => {
    it('should deactivate a link and clear cache', async () => {
      const mockLink = { id: '123', slug: 'abc' };
      const mockUpdated = { ...mockLink, active: false };

      mockPrisma.link.findUnique.mockResolvedValue(mockLink);
      mockPrisma.link.update.mockResolvedValue(mockUpdated);

      const result = await service.deactivate('abc');

      expect(result.active).toBe(false);
      expect(mockRedis.del).toHaveBeenCalledWith('link:abc');
    });

    it('should throw NotFoundException if link not found', async () => {
      mockPrisma.link.findUnique.mockResolvedValue(null);

      await expect(service.deactivate('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findBySlug', () => {
    it('should return cached link if available', async () => {
      const cachedLink = { id: '123', slug: 'abc', url: 'https://example.com' };

      mockRedis.get.mockResolvedValue(cachedLink);

      const result = await service.findBySlug('abc');

      expect(result).toEqual(cachedLink);
      expect(mockPrisma.link.findUnique).not.toHaveBeenCalled();
    });

    it('should fetch from database and cache if not in cache', async () => {
      const dbLink = { id: '123', slug: 'abc', url: 'https://example.com' };

      mockRedis.get.mockResolvedValue(null);
      mockPrisma.link.findUnique.mockResolvedValue(dbLink);

      const result = await service.findBySlug('abc');

      expect(result).toEqual(dbLink);
      expect(mockRedis.set).toHaveBeenCalledWith('link:abc', dbLink, 3600);
    });

    it('should return null if link not found anywhere', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.link.findUnique.mockResolvedValue(null);

      const result = await service.findBySlug('nonexistent');

      expect(result).toBeNull();
    });
  });
});