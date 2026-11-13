const ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

export function generateSlug(size = 7): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let slug = '';
  for (const byte of bytes) slug += ALPHABET[byte & 63];
  return slug;
}
