import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fixturePng } from './fixture-png.mjs';
export const lutNames = ['warm-film', 'teal-orange', 'bleach', 'mono'];
/** Original deterministic creative looks, not engine/vendor preset replicas. sRGB input/output. */
export function gradeSample(name, r, g, b) {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const clamp = (value) => Math.min(1, Math.max(0, value));
  let out;
  if (name === 'warm-film')
    out = [r * 1.04 + 0.018, g * 0.99 + 0.006, b * 0.92];
  else if (name === 'teal-orange') {
    const shadow = 1 - y;
    out = [
      r + 0.055 * y - 0.025 * shadow,
      g + 0.015 * shadow,
      b + 0.05 * shadow - 0.045 * y,
    ];
  } else if (name === 'bleach')
    out = [r, g, b].map((c) => (c * 0.45 + y * 0.55 - 0.5) * 1.18 + 0.5);
  else if (name === 'mono') out = [y, y, y];
  else throw new Error('unknown look');
  return out.map(clamp);
}
export function editorLut(name) {
  return fixturePng(512, 512, (x, y) =>
    gradeSample(
      name,
      (x % 64) / 63,
      (y % 64) / 63,
      (Math.floor(y / 64) * 8 + Math.floor(x / 64)) / 63,
    ).map((c) => Math.round(c * 255)),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('../apps/web/public/luts/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const name of lutNames)
    writeFileSync(new URL(`${name}.png`, dir), editorLut(name));
}
