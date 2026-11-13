export type Link = {
  id: string;
  slug: string;
  url: string;
  active: boolean;
  expiresAt: Date | null;
  maxClicks: number | null;
  clickCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type LinkRow = {
  id: string;
  slug: string;
  url: string;
  active: boolean;
  expires_at: Date | null;
  max_clicks: number | null;
  click_count: number;
  created_at: Date;
  updated_at: Date;
};

export function toLink(row: LinkRow): Link {
  return {
    id: row.id,
    slug: row.slug,
    url: row.url,
    active: row.active,
    expiresAt: row.expires_at,
    maxClicks: row.max_clicks,
    clickCount: row.click_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
