import { IsBoolean } from 'class-validator';

export class UpdateLinkDto {
  @IsBoolean({ message: 'active must be a boolean' })
  active!: boolean;
}
