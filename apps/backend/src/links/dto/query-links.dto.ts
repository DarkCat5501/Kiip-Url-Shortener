import { rejectUnknown, throwIfAny, type Errors } from '../../_core/validation.js';

export enum LinkSortField {
  CreatedAt = 'createdAt',
  ClickCount = 'clickCount',
}

export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc',
}

export type QueryLinksDto = {
  page: number;
  pageSize: number;
  q?: string;
  sortField: LinkSortField;
  sortOrder: SortOrder;
};

function parseInteger(name: string, raw: string | undefined, fallback: number, min: number, max: number | undefined, errors: Errors): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) errors.push(`${name} must be an integer number`);
  else if (value < min) errors.push(`${name} must not be less than ${min}`);
  else if (max !== undefined && value > max) errors.push(`${name} must not be greater than ${max}`);
  return value;
}

function parseEnum<T extends string>(name: string, raw: string | undefined, values: T[], fallback: T, errors: Errors): T {
  if (raw === undefined) return fallback;
  if (!values.includes(raw as T)) errors.push(`${name} must be one of the following values: ${values.join(', ')}`);
  return raw as T;
}

export function parseQueryLinksDto(params: URLSearchParams): QueryLinksDto {
  const input = Object.fromEntries(params) as Record<string, string>;
  const errors: Errors = [];

  rejectUnknown(input, ['page', 'pageSize', 'q', 'sortField', 'sortOrder'], errors);

  const page = parseInteger('page', input.page, 1, 1, undefined, errors);
  const pageSize = parseInteger('pageSize', input.pageSize, 10, 1, 100, errors);
  const sortField = parseEnum('sortField', input.sortField, Object.values(LinkSortField), LinkSortField.CreatedAt, errors);
  const sortOrder = parseEnum('sortOrder', input.sortOrder, Object.values(SortOrder), SortOrder.Desc, errors);

  if (input.q !== undefined && input.q.length > 10) {
    errors.push('q must be shorter than or equal to 10 characters');
  }

  throwIfAny(errors);

  return { page, pageSize, q: input.q, sortField, sortOrder };
}
