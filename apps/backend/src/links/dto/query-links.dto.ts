import { IsOptional, IsString, IsInt, Min, Max, IsEnum, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export enum LinkSortField {
  CreatedAt = 'createdAt',
  ClickCount = 'clickCount',
}

export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc',
}

export class QueryLinksDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 10;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  q?: string;

  @IsOptional()
  @IsEnum(LinkSortField)
  sortField: LinkSortField = LinkSortField.CreatedAt;

  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.Desc;
}
