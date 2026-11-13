import { asObject, rejectUnknown, throwIfAny, type Errors } from '../../_core/validation.js';

export type UpdateLinkDto = {
  active: boolean;
};

export function parseUpdateLinkDto(body: unknown): UpdateLinkDto {
  const input = asObject(body);
  const errors: Errors = [];

  rejectUnknown(input, ['active'], errors);
  if (typeof input.active !== 'boolean') errors.push('active must be a boolean');

  throwIfAny(errors);

  return { active: input.active as boolean };
}
