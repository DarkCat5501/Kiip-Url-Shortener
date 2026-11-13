// Chaves Redis centralizadas — usadas tanto em LinksService quanto em
// RedirectService para o cache do link e o contador de cliques pendente.
// Ambos indexados por slug (não por id): o id só existe depois do flush
// persistir o link no Postgres (autoincrement), enquanto o slug é conhecido
// desde o momento da criação.
// Prefixos curtos de propósito: menos bytes por chave reduzem o custo de
// hashing e a memória usada pela hash table interna do Redis em escala.
export const REDIS_LINK_KEY = (slug: string) => `l:${slug}`;
export const REDIS_LINK_DETAIL_KEY = (slug: string) => `l:${slug}:d`;
export const REDIS_CLICK_COUNT_KEY = (slug: string) => `c:${slug}`;

export const LINK_BUFFER_KEY = 'b:links';
export const ACCESS_LOG_BUFFER_KEY = 'b:acc_logs';
export const LINKS_LIST_CACHE_PREFIX = 'll:';

// Versão das listagens em cache: invalidar = incrementar (O(1)); as chaves da
// versão anterior expiram sozinhas pelo TTL, sem varrer o keyspace.
export const LINKS_LIST_VERSION_KEY = 'llv';
