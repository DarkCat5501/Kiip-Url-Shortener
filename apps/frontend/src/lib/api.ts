const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface Link {
  id: string;
  slug: string;
  url: string;
  active: boolean;
  expiresAt: string | null;
  maxClicks: number | null;
  createdAt: string;
  updatedAt: string;
  shortUrl: string;
  clickCount?: number;
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

export async function getLinks(): Promise<Link[]> {
  const res = await fetch(`${API_URL}/links`);
  if (!res.ok) throw new Error('Failed to fetch links');
  return res.json();
}

export async function getLinkStats(slug: string): Promise<LinkStats> {
  const res = await fetch(`${API_URL}/links/${slug}/stats`);
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

export async function deactivateLink(slug: string): Promise<Link> {
  const res = await fetch(`${API_URL}/links/${slug}`, { method: 'PATCH' });
  if (!res.ok) throw new Error('Failed to deactivate link');
  return res.json();
}