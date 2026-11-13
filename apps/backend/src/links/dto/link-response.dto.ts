// id é PK/FK interna, nunca exposta na API. Campos opcionais ausentes
// (undefined) ficam de fora do JSON; os null são mantidos.
export type LinkResponseDto = {
  slug: string;
  url: string;
  active: boolean;
  expiresAt?: Date | string | null;
  maxClicks?: number | null;
  clickCount: number;
  createdAt: Date | string;
  updatedAt?: Date | string;
  shortUrl?: string;
};

export function toLinkResponse(link: LinkResponseDto): LinkResponseDto {
  return {
    slug: link.slug,
    url: link.url,
    active: link.active,
    expiresAt: link.expiresAt,
    maxClicks: link.maxClicks,
    clickCount: link.clickCount,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    shortUrl: link.shortUrl,
  };
}
