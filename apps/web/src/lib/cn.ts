export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}
export function variants<T extends string>(
  base: string,
  map: Record<T, string>,
  value: T,
): string {
  return cn(base, map[value]);
}
