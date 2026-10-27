/** Exact +4 percentage points HSL lightness, starting from resolved track tokens. */
export function hoverTint(color: string): string {
  const hex = color.startsWith('#') ? color.slice(1) : '';
  const rgb =
    hex.length === 6
      ? [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
      : color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
  if (!rgb || rgb.length !== 3 || rgb.some((n) => !Number.isFinite(n)))
    return color;
  const r = (rgb[0] ?? 0) / 255;
  const g = (rgb[1] ?? 0) / 255;
  const b = (rgb[2] ?? 0) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const hue =
    delta === 0
      ? 0
      : max === r
        ? ((g - b) / delta + (g < b ? 6 : 0)) * 60
        : max === g
          ? ((b - r) / delta + 2) * 60
          : ((r - g) / delta + 4) * 60;
  return `hsl(${hue} ${saturation * 100}% ${Math.min(100, lightness * 100 + 4)}%)`;
}
