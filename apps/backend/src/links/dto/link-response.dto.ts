import { Exclude, Expose } from 'class-transformer';

// id é PK/FK interna, nunca exposta na API — Exclude também evita quebrar
// JSON.stringify nativo do Express, que não serializa bigint.
// Campos opcionais (expiresAt, maxClicks) ausentes ficam de fora da resposta
// via ClassSerializerInterceptor configurado com exposeUnsetFields: false.
export class LinkResponseDto {
  @Exclude()
  id?: bigint;

  @Expose()
  slug!: string;

  @Expose()
  url!: string;

  @Expose()
  active!: boolean;

  @Expose()
  expiresAt?: Date | null;

  @Expose()
  maxClicks?: number | null;

  @Expose()
  clickCount!: number;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt?: Date;

  @Expose()
  shortUrl?: string;

  constructor(partial: Partial<LinkResponseDto>) {
    Object.assign(this, partial);
  }
}
