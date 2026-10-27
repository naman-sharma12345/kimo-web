import { describe, expect, it } from 'vitest';
import type { Asset, KimoProject } from '@kimo/client';
import {
  comparisonAsset,
  comparisonInstance,
  comparisonResources,
  comparisonSplit,
} from './comparison';
import { buildScene } from './scene-builder';
const asset: Asset = {
  id: 'v',
  kind: 'video',
  name: 'video',
  url: '/v',
  source: 'user',
};
const project: KimoProject = {
  id: 'p',
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 10,
  markers: [],
  tracks: [
    {
      id: 't',
      name: 'video',
      kind: 'video',
      height: 64,
      muted: false,
      hidden: false,
      locked: false,
    },
  ],
  clips: {
    a: {
      id: 'a',
      assetId: 'v',
      trackId: 't',
      kind: 'video',
      start: 0,
      duration: 10,
      in: 2,
      speed: 2,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      effects: [],
      keyframes: [],
    },
  },
};
describe('comparison resource planning (pure source evidence)', () => {
  it('clamps finite split values and rejects nonfinite values', () => {
    expect(comparisonSplit(-1)).toBe(0);
    expect(comparisonSplit(2)).toBe(1);
    expect(comparisonSplit(0.3)).toBe(0.3);
    for (const value of [NaN, Infinity, -Infinity])
      expect(() => comparisonSplit(value)).toThrow(RangeError);
  });
  it('uses opaque unambiguous branch/role/generation identities without rewriting scene IDs', () => {
    const ids = [
      comparisonInstance(1, 'current', 'a:mask', 'media'),
      comparisonInstance(1, 'current', 'a', 'mask'),
      comparisonInstance(1, 'historical', 'a', 'mask'),
      comparisonInstance(2, 'historical', 'a', 'mask'),
      comparisonAsset(1, 'a'),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    const scene = buildScene(project, 1, { assets: { v: asset } });
    const plan = comparisonResources(
      project,
      { v: asset },
      scene,
      'current',
      1,
    );
    expect(scene.layers[0]?.clipId).toBe('a');
    expect(plan.videos[0]?.sourceTiming).toEqual({
      timelineTime: 1,
      mediaTime: 4,
      rate: 2,
    });
    expect([...plan.currentMedia.values()]).toEqual(['a']);
    expect(plan.resources[0]).toMatchObject({
      branch: 'current',
      clipId: 'a',
      assetId: 'v',
    });
  });
  it('counts mask instances and resolved transition boundary samples, subtracting origin once', () => {
    const scene = buildScene(project, 1, { assets: { v: asset } });
    const layer = required(scene.layers[0]);
    layer.sourceTime = 7;
    layer.transitionSample = {
      mode: 'boundary',
      requestedSourceTime: 8,
      sampleTimelineTime: 1,
    };
    layer.mask = {
      assetId: 'm',
      sourceTime: 5,
      feather: 0,
      invert: false,
      mode: 'cutout',
      metadata: {
        encoding: 'video',
        width: 10,
        height: 10,
        fps: 30,
        timeOrigin: 3,
        coordinateSpace: 'source_uv',
        channel: 'luma',
      },
    };
    const plan = comparisonResources(
      project,
      { v: asset, m: { ...asset, id: 'm' } },
      scene,
      'historical',
      9,
    );
    expect(plan.videos).toHaveLength(2);
    expect(plan.videos.map((item) => item.sourceTiming)).toEqual([
      { timelineTime: 1, mediaTime: 7, rate: 0 },
      { timelineTime: 1, mediaTime: 2, rate: 0 },
    ]);
    expect(plan.currentMedia.size).toBe(0);
  });
  it('does not count image/RLE/LUT resources as video decoders or add future preroll', () => {
    const scene = buildScene(project, 1, { assets: { v: asset } });
    const layer = required(scene.layers[0]);
    layer.mask = {
      assetId: 'rle',
      sourceTime: 1,
      feather: 0,
      invert: false,
      mode: 'cutout',
      frameIndex: 30,
    };
    layer.effects = [
      { id: 'lut', kind: 'lut', scope: 'all', params: { assetId: 'lut' } },
    ];
    const plan = comparisonResources(
      project,
      { v: { ...asset, kind: 'image' } },
      scene,
      'current',
      1,
    );
    expect(plan.videos).toHaveLength(0);
    expect(plan.resources.map((item) => item.role)).toEqual([
      'media',
      'mask',
      'lut',
    ]);
    expect(plan.resources[1]?.frameIndex).toBe(30);
  });
});

function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('Required test fixture missing');
  return value;
}
