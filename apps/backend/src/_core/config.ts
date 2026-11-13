export function getString(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? defaultValue : value;
}

export function getNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value === undefined || value === '' ? defaultValue : Number(value);
}
