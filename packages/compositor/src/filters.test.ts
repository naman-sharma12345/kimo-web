import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() =>
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null),
);
vi.mock('pixi.js', async (original) => {
  const pixi = await original<typeof import('pixi.js')>();
  return { ...pixi, GlProgram: { from: vi.fn((options: unknown) => options) } };
});
import { Texture } from 'pixi.js';
import {
  compositeMasked,
  gaussianWeights,
  grainValue,
  mixPremultiplied,
  normalizeFilterParams,
  vignetteFactor,
  decodeRLE,
  encode,
  filterShaderSources,
  gradeRGB,
  linearize,
  LiveFilter,
  lutAtlasUV,
  sampleLUT,
  scalar,
} from './filters';

describe('declared CPU color formula vectors, not GPU goldens', () => {
  it.each([0, 0.01, 0.04045, 0.18, 0.5, 1])('sRGB roundtrip %s', (v) =>
    expect(encode(linearize(v))).toBeCloseTo(v, 6),
  );
  it('identity grade preserves swatches', () => {
    for (const rgb of [
      [0, 0, 0],
      [1, 1, 1],
      [0.2, 0.5, 0.8],
    ] as const)
      gradeRGB(rgb, {}).forEach((v, i) =>
        expect(v).toBeCloseTo(rgb[i] ?? 0, 6),
      );
  });
  it('exposure is stops in linear light and contrast pivots about 0.18', () => {
    expect(
      gradeRGB([encode(0.18), encode(0.18), encode(0.18)], { contrast: 2 })[0],
    ).toBeCloseTo(encode(0.18));
    expect(gradeRGB([0.5, 0.5, 0.5], { exposure: 1 })[0]).toBeCloseTo(
      encode(2 * linearize(0.5)),
    );
  });
  it('desaturates to linear Rec709 luma', () => {
    const expected = encode(0.2126);
    gradeRGB([1, 0, 0], { saturation: 0 }).forEach((v) =>
      expect(v).toBeCloseTo(expected),
    );
  });
  it('temperature/tint are channel offsets before lift/gamma/gain', () => {
    const c = gradeRGB([0.5, 0.5, 0.5], { temperature: 1, tint: 1 });
    expect(c[0]).toBeGreaterThan(0.5);
    expect(c[1]).toBeLessThan(0.5);
    expect(c[2]).toBeLessThan(0.5);
    expect(
      gradeRGB([0, 0, 0], { liftR: 0.25, gammaR: 2, gainR: 0.5 })[0],
    ).toBeCloseTo(encode(0.25));
  });
  it('clamps finite extreme grades and rejects nonnumeric scalar controls', () => {
    expect(gradeRGB([0, 0, 0], { liftR: -1, gammaR: 0 })).toEqual([0, 0, 0]);
    expect(scalar({ x: NaN }, 'x', 3)).toBe(3);
    expect(scalar({ x: '4' }, 'x', 3)).toBe(3);
  });
});
describe('64 cube / 512 atlas trilinear vectors', () => {
  it('uses red horizontal, green vertical, blue 8x8 tiles and texel centers', () => {
    expect(lutAtlasUV(0, 0, 0)).toEqual([0.5 / 512, 0.5 / 512]);
    expect(lutAtlasUV(1, 1, 63)).toEqual([511.5 / 512, 511.5 / 512]);
    expect(lutAtlasUV(0, 0, 8)).toEqual([0.5 / 512, 64.5 / 512]);
  });
  it.each([
    [0, 0, 0],
    [1, 1, 1],
    [0.12, 0.55, 0.91],
  ] as const)('identity LUT %s,%s,%s', (r, g, b) => {
    const result = sampleLUT([r, g, b], (x, y) => [
      (x % 64) / 63,
      (y % 64) / 63,
      (Math.floor(y / 64) * 8 + Math.floor(x / 64)) / 63,
    ]);
    result.forEach((v, i) => expect(v).toBeCloseTo([r, g, b][i] ?? 0, 6));
  });
  it('interpolates all eight cube corners rather than nearest blue slice', () => {
    const visited = new Set<string>();
    const c = sampleLUT([0.5, 0.5, 0.5], (x, y) => {
      visited.add(`${x},${y}`);
      return [0.2, 0.4, 0.6];
    });
    expect(visited.size).toBe(8);
    expect(c[0]).toBeCloseTo(0.2);
    expect(c[2]).toBeCloseTo(0.6);
  });
});
describe('row-major RLE masks', () => {
  it('starts with zero run and emits RGBA coverage for declared alpha/red/luma channel', () => {
    const bytes = decodeRLE(3, 2, [1, 2, 2, 1]);
    expect(Array.from(bytes.filter((_, i) => i % 4 === 0))).toEqual([
      0, 255, 255, 0, 0, 255,
    ]);
    expect(Array.from(bytes.filter((_, i) => i % 4 === 3))).toEqual([
      0, 255, 255, 0, 0, 255,
    ]);
  });
  it('accepts initial zero count to begin foreground', () =>
    expect(Array.from(decodeRLE(1, 1, [0, 1]))).toEqual([255, 255, 255, 255]));
  it.each([
    [2, 2, [3]],
    [2, 2, [5]],
    [2, 2, [-1, 5]],
    [2, 2, [0.5, 3.5]],
    [0, 1, []],
    [1e9, 1e9, []],
  ] as const)('rejects malformed dimensions/runs %s %s', (w, h, runs) =>
    expect(() => decodeRLE(w, h, runs)).toThrow(),
  );
});
describe('real Pixi reflection and filter state without a GPU', () => {
  it('reflects both entrypoints and all resource bindings', () => {
    const filter = new LiveFilter();
    expect(filter.gpuProgram?.layout[1]).toEqual({
      fx: 0,
      uMask: 1,
      maskSampler: 2,
      uLut: 3,
      lutSampler: 4,
    });
    expect(filter.gpuProgram?.vertex?.entryPoint).toBe('mainVertex');
    expect(filter.gpuProgram?.fragment?.entryPoint).toBe('mainFragment');
    expect(filter.glProgram).toBeDefined();
    filter.destroy();
  });
  it('configures inside/outside masks, inversion, source-pixel feather and channel', () => {
    const filter = new LiveFilter();
    filter.configure(
      'grade',
      {},
      12,
      'outside_mask',
      Texture.WHITE,
      undefined,
      true,
      2,
      'luma',
    );
    expect(Array.from(filter.values[0])).toEqual([1, 2, 1, 1]);
    expect(filter.values[5][0]).toBe(2 / Texture.WHITE.width);
    expect(filter.values[6][1]).toBeCloseTo(0.7152);
    filter.configure('mask', {}, 12, 'all', Texture.WHITE);
    expect(filter.values[0][1]).toBe(3);
    filter.destroy();
  });
  it('uses fixed project-frame grain and separate deterministic mode uniforms', () => {
    const f = new LiveFilter();
    f.configure('grain', { seed: 4, amount: 0.2 }, 30);
    expect(f.values[1][1]).toBe(34);
    const first = Array.from(f.values[1]);
    f.configure('grain', { seed: 4, amount: 0.2 }, 30);
    expect(Array.from(f.values[1])).toEqual(first);
    f.configure('whip', { x: 64, y: -32 }, 0);
    expect(Array.from(f.values[1])).toEqual([64, -32, 0, 0]);
    f.destroy();
  });
  it('generated source has no untranslated common-language tokens', () => {
    for (const source of Object.values(filterShaderSources))
      expect(source).not.toMatch(
        /\b(?:V2|V3|V4|F|INPUT|FRAME|MASK|RETURN|P[0-7]|MAP)\b/,
      );
    expect(filterShaderSources.gl).toContain('uOutputFrame');
    expect(filterShaderSources.gpu).toContain(
      'textureSample(uMask,maskSampler,',
    );
    expect(filterShaderSources.gpu).not.toContain('for(int');
    expect(filterShaderSources.gl).not.toContain('var ');
    expect(filterShaderSources.gl).not.toMatch(
      /vec[234]f|mat[234]x[234]f|textureSample/,
    );
  });
});

describe('CPU compositing and kernel vectors, not hardware pixels', () => {
  it('mixes opaque red/blue to opaque purple with no green backdrop leak', () => {
    expect(mixPremultiplied([1, 0, 0, 1], [0, 0, 1, 1], 0.5, 0.5)).toEqual([
      0.5, 0, 0.5, 1,
    ]);
    expect(mixPremultiplied([1, 0, 0, 1], [0, 0, 1, 1], 0, 0, 1)).toEqual([
      0, 0, 0, 1,
    ]);
  });
  it('retains premultiplied transparency and adds dip black alpha', () => {
    expect(
      mixPremultiplied([0.5, 0, 0, 0.5], [0, 0, 0.25, 0.25], 0.5, 0.5),
    ).toEqual([0.25, 0, 0.125, 0.375]);
    expect(mixPremultiplied([1, 0, 0, 1], [0, 0, 1, 1], 0.5, 0, 0.5)).toEqual([
      0.5, 0, 0, 1,
    ]);
  });
  it('inside/outside/invert interpolate the full premultiplied stage input', () => {
    const a = [1, 0, 0, 1] as const,
      b = [0, 0, 1, 1] as const;
    expect(compositeMasked(a, b, 0.25, 'inside_mask')).toEqual([
      0.75, 0, 0.25, 1,
    ]);
    expect(compositeMasked(a, b, 0.25, 'outside_mask')).toEqual([
      0.25, 0, 0.75, 1,
    ]);
    expect(compositeMasked(a, b, 0.25, 'inside_mask', true)).toEqual([
      0.25, 0, 0.75, 1,
    ]);
  });
  it('nine-tap Gaussian is normalized, symmetric, leaves constants invariant and gives known impulse response', () => {
    const weights = gaussianWeights();
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(weights).toEqual([...weights].reverse());
    expect(weights[4]).toBeCloseTo(0.2041636887, 9);
    expect(weights.reduce((sum, w) => sum + 0.4 * w, 0)).toBeCloseTo(0.4, 12);
    expect((weights[4] ?? 0) ** 2).toBeCloseTo(0.04168281179, 9);
  });
  it('vignette has unchanged center and declared edge attenuation', () => {
    expect(vignetteFactor(0.5, 0.5)).toBe(1);
    expect(vignetteFactor(1, 0.5)).toBe(0.5);
    expect(vignetteFactor(0, 0)).toBe(0.5);
  });
  it('grain depends only on source pixel, project frame and explicit seed', () => {
    const a = grainValue(20, 30, 60, 7);
    expect(grainValue(20, 30, 60, 7)).toBe(a);
    expect(grainValue(20, 30, 61, 7)).not.toBe(a);
    expect(Math.abs(a)).toBeLessThanOrEqual(0.05);
  });
});

describe('preview parameter registry', () => {
  it('bounds dangerous scalar values and reports every substitution', () => {
    const result = normalizeFilterParams('grade', {
      exposure: 100,
      gammaR: 0,
      unknown: 1,
    });
    expect(result.params).toEqual({ exposure: 16, gammaR: 0.001 });
    expect(result.issues).toHaveLength(3);
  });
  it('rejects nonnumeric controls and guards equal vignette radii', () => {
    const result = normalizeFilterParams('vignette', {
      inner: 1,
      outer: 1,
      strength: 'high',
    });
    expect(result.params.outer).toBeGreaterThan(1);
    expect(result.issues).toHaveLength(2);
  });
  it('supports global lift/gamma/gain with RGB overrides', () => {
    const all = gradeRGB([0, 0, 0], {
      lift: 0.25,
      gamma: 2,
      gain: 0.5,
      gainB: 1,
    });
    expect(all[0]).toBeCloseTo(encode(0.25));
    expect(all[1]).toBeCloseTo(all[0]);
    expect(all[2]).toBeCloseTo(encode(0.5));
  });
});
