import type { PreparedRendererResource } from '@kimo/compositor';
/** Bounded CPU edge readback for the DOM overlay. Derived from actual mask pixels, not the SAM polygon.
 * Downsampled to 128px for interaction overlays; it is not a server-resolution segmentation contour. */
export function maskEdgePath(
  resource: PreparedRendererResource,
  channel: 'alpha' | 'luma' | 'red',
  invert = false,
): string {
  const width = Math.max(1, Math.min(128, resource.width)),
    height = Math.max(
      1,
      Math.round((resource.height * width) / resource.width),
    );
  if (height > 512)
    throw new Error('mask overlay aspect exceeds readback budget');
  const source = resource.source;
  let pixels: Uint8Array | Uint8ClampedArray;
  let sourceWidth = width,
    sourceHeight = height;
  if ('data' in source) {
    pixels = source.data;
    sourceWidth = source.width;
    sourceHeight = source.height;
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('mask overlay readback unavailable');
    context.drawImage(source, 0, 0, width, height);
    pixels = context.getImageData(0, 0, width, height).data;
  }
  const sample = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const sx = Math.min(
      sourceWidth - 1,
      Math.floor(((x + 0.5) * sourceWidth) / width),
    );
    const sy = Math.min(
      sourceHeight - 1,
      Math.floor(((y + 0.5) * sourceHeight) / height),
    );
    const offset = (sy * sourceWidth + sx) * 4;
    const r = pixels[offset] ?? 0,
      g = pixels[offset + 1] ?? 0,
      b = pixels[offset + 2] ?? 0,
      a = pixels[offset + 3] ?? 0;
    const value =
      channel === 'alpha'
        ? a
        : channel === 'red'
          ? r
          : 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return invert ? value < 128 : value >= 128;
  };
  const segments: string[] = [];
  const coordinate = (n: number, max: number) => Number((n / max).toFixed(5));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (sample(x, y)) {
        const left = coordinate(x, width),
          right = coordinate(x + 1, width),
          top = coordinate(y, height),
          bottom = coordinate(y + 1, height);
        if (!sample(x - 1, y)) segments.push(`M${left} ${top}V${bottom}`);
        if (!sample(x + 1, y)) segments.push(`M${right} ${top}V${bottom}`);
        if (!sample(x, y - 1)) segments.push(`M${left} ${top}H${right}`);
        if (!sample(x, y + 1)) segments.push(`M${left} ${bottom}H${right}`);
      }
  return segments.join(' ');
}
