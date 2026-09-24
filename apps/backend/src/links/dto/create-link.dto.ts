import { IsUrl, IsOptional, IsString, IsDateString, IsInt, Min, MaxLength } from 'class-validator';

export class CreateLinkDto {
  @IsUrl({}, { message: 'URL must be a valid URL' })
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10, { message: 'Slug must be at most 10 characters' })
  slug?: string;

  @IsOptional()
  @IsDateString({}, { message: 'expiresAt must be a valid ISO 8601 date' })
  expiresAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'maxClicks must be at least 1' })
  maxClicks?: number;
}