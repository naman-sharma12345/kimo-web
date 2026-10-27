import type { Asset } from '@kimo/client';
/** Authored frontend creative looks. IDs are not backend or vendor preset identities. */
export const builtinLutIds = {
  'warm film': 'kimo-local-lut-warm-film',
  'teal & orange': 'kimo-local-lut-teal-orange',
  bleach: 'kimo-local-lut-bleach',
  mono: 'kimo-local-lut-mono',
} as const;
const filenames = ['warm-film', 'teal-orange', 'bleach', 'mono'] as const;
export const builtinLutAssets: readonly Asset[] = Object.entries(
  builtinLutIds,
).map(([name, id], index) => ({
  id,
  kind: 'image',
  name,
  url: `/luts/${filenames[index]}.png`,
  width: 512,
  height: 512,
  source: 'web',
  lut: { size: 64, layout: 'tiles_8x8', colorSpace: 'srgb' },
}));
export function withBuiltinAssets(assets: readonly Asset[]): Asset[] {
  const ids = new Set(assets.map((asset) => asset.id));
  return [...assets, ...builtinLutAssets.filter((asset) => !ids.has(asset.id))];
}
