import { HttpError } from './http.js';

export type Errors = string[];

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'Bad Request');
  }
  return value as Record<string, unknown>;
}

export function rejectUnknown(input: Record<string, unknown>, allowed: string[], errors: Errors): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) errors.push(`property ${key} should not exist`);
  }
}

export function throwIfAny(errors: Errors): void {
  if (errors.length > 0) throw new HttpError(400, errors);
}

export function isUrl(value: unknown): boolean {
  if (typeof value !== 'string' || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'ftp:'].includes(url.protocol) && url.hostname.includes('.');
  } catch {
    return false;
  }
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function isDateString(value: unknown): boolean {
  return typeof value === 'string' && ISO_8601.test(value) && !Number.isNaN(Date.parse(value));
}
