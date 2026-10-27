// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { identityLut, syntheticMask } from '../../../scripts/fixture-png.mjs';

function decode(png: Buffer) {
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[24]).toBe(8);
  expect(png[25]).toBe(2);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.subarray(offset + 4, offset + 8).toString() === 'IDAT')
      chunks.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const pixels = inflateSync(Buffer.concat(chunks));
  expect(pixels.length).toBe((width * 3 + 1) * height);
  return {
    width,
    height,
    rgb: (x: number, y: number) => [
      ...pixels.subarray(
        y * (width * 3 + 1) + 1 + x * 3,
        y * (width * 3 + 1) + 4 + x * 3,
      ),
    ],
  };
}

describe('original compositor fixtures', () => {
  it('generates a genuine binary ellipse luma mask, not footage', () => {
    const mask = decode(syntheticMask());
    expect([mask.width, mask.height]).toEqual([640, 360]);
    expect(mask.rgb(320, 180)).toEqual([255, 255, 255]);
    expect(mask.rgb(0, 0)).toEqual([0, 0, 0]);
    expect(mask.rgb(210, 180)).toEqual([255, 255, 255]);
    expect(mask.rgb(209, 180)).toEqual([0, 0, 0]);
    expect(syntheticMask()).toEqual(syntheticMask());
  });
  it('generates an identity 64-cube LUT with explicit top-left tile order', () => {
    const lut = decode(identityLut());
    expect([lut.width, lut.height]).toEqual([512, 512]);
    expect(lut.rgb(0, 0)).toEqual([0, 0, 0]);
    expect(lut.rgb(63, 63)).toEqual([255, 255, 0]);
    expect(lut.rgb(64, 0)).toEqual([0, 0, 4]);
    expect(lut.rgb(0, 64)).toEqual([0, 0, 32]);
    expect(lut.rgb(511, 511)).toEqual([255, 255, 255]);
    expect(identityLut()).toEqual(identityLut());
  });
});
