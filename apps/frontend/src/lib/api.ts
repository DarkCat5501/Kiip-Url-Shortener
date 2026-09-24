const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface Link {
  id: string;
  slug: string;
  url: string;
  active: boolean;
  expiresAt?: string;
  maxClicks?: number;
  createdAt: string;
  updatedAt: string;
  shortUrl: string;
  clickCount?: number;
}

export interface PaginatedLinks {
  items: Link[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface LinkStats {
  slug: string;
  url: string;
  active: boolean;
  createdAt: string;
  totalClicks: number;
  dailyStats: { date: string; count: number }[];
  recentAccesses: { accessedAt: string; referer: string | null; userAgent: string | null }[];
}

export async function createLink(data: { url: string; slug?: string; expiresAt?: string; maxClicks?: number }): Promise<Link> {
  const res = await fetch(`${API_URL}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to create link');
  }
  return res.json();
}

export interface GetLinksParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sortField?: 'createdAt' | 'clickCount';
  sortOrder?: 'asc' | 'desc';
}

export async function getLinks(params: GetLinksParams = {}): Promise<PaginatedLinks> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  if (params.q) search.set('q', params.q);
  if (params.sortField) search.set('sortField', params.sortField);
  if (params.sortOrder) search.set('sortOrder', params.sortOrder);

  const query = search.toString();
  const res = await fetch(`${API_URL}/links${query ? `?${query}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch links');
  return res.json();
}

export async function getLinkStats(slug: string): Promise<LinkStats> {
  const res = await fetch(`${API_URL}/links/${slug}/stats`);
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

export async function setLinkActive(slug: string, active: boolean): Promise<Link> {
  const res = await fetch(`${API_URL}/links/${slug}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || `Failed to ${active ? 'reactivate' : 'deactivate'} link`);
  }
  return res.json();
}