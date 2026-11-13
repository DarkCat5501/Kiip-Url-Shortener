import { asObject, isDateString, isUrl, rejectUnknown, throwIfAny, type Errors } from '../../_core/validation.js';

export type CreateLinkDto = {
  url: string;
  slug?: string;
  expiresAt?: string;
  maxClicks?: number;
};

export function parseCreateLinkDto(body: unknown): CreateLinkDto {
  const input = asObject(body);
  const errors: Errors = [];

  rejectUnknown(input, ['url', 'slug', 'expiresAt', 'maxClicks'], errors);

  if (!isUrl(input.url)) errors.push('URL must be a valid URL');

  if (input.slug !== undefined && input.slug !== null) {
    if (typeof input.slug !== 'string') errors.push('slug must be a string');
    else if (input.slug.length > 10) errors.push('Slug must be at most 10 characters');
  }

  if (input.expiresAt !== undefined && input.expiresAt !== null && !isDateString(input.expiresAt)) {
    errors.push('expiresAt must be a valid ISO 8601 date');
  }

  if (input.maxClicks !== undefined && input.maxClicks !== null) {
    if (!Number.isInteger(input.maxClicks)) errors.push('maxClicks must be an integer number');
    else if ((input.maxClicks as number) < 1) errors.push('maxClicks must be at least 1');
  }

  throwIfAny(errors);

  return {
    url: input.url as string,
    slug: (input.slug as string | null | undefined) ?? undefined,
    expiresAt: (input.expiresAt as string | null | undefined) ?? undefined,
    maxClicks: (input.maxClicks as number | null | undefined) ?? undefined,
  };
}
