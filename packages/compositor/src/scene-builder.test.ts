import { describe, expect, it } from 'vitest';
import type { Asset, Clip, KimoProject, Track } from '@kimo/client';
import { applyOps } from '../../kimo-client/src/ops';
import {
  animationTime,
  buildScene,
  duckGainAt,
  interpolateKeyframes,
  PureSceneBuilder,
  sourceTime,
  transitionDuration,
} from './scene-builder';
const track = (id: string, patch: Partial<Track> = {}): Track => ({
  id,
  kind: 'video',
  name: id,
  height: 64,
  muted: false,
  hidden: false,
  locked: false,
  ...patch,
});
const clip = (id: string, patch: Partial<Clip> = {}): Clip => ({
  id,
  trackId: 'v',
  kind: 'video',
  assetId: 'a',
  start: 2,
  duration: 8,
  in: 3,
  speed: 2,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.8 },
  effects: [],
  keyframes: [],
  ...patch,
});
const project = (clips: Clip[], tracks = [track('v')]): KimoProject => ({
  id: 'p',
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 20,
  tracks,
  clips: Object.fromEntries(clips.map((c) => [c.id, c])),
  markers: [],
});
const asset: Asset = {
  id: 'a',
  kind: 'video',
  name: 'a',
  url: '/a',
  source: 'user',
  durationSec: 60,
};
const options = { assets: { a: asset } };
const layer = (c: Clip, t = 3) =>
  buildScene(project([c]), t, options).layers[0];

describe('pure scene timeline and source vectors', () => {
  it.each([
    [1.999, 0],
    [2, 1],
    [9.999, 1],
    [10, 0],
    [11, 0],
    [-1, 0],
  ])('uses half-open visibility at %s', (t, count) => {
    expect(buildScene(project([clip('c')]), t).layers).toHaveLength(count);
  });
  it.each([
    [0.5, 3.5],
    [1, 4],
    [2, 5],
    [4, 7],
  ])('source math at speed %s', (speed, expected) => {
    expect(sourceTime(clip('c', { speed }), 3)).toBe(expected);
  });
  it('is deterministic, keeps inputs untouched and supports static and instance entrypoints', () => {
    const p = project([
      clip('c', {
        keyframes: [
          { property: 'x', time: 8, value: 80 },
          { property: 'x', time: 0, value: 0 },
        ],
      }),
    ]);
    const before = structuredClone(p);
    expect(PureSceneBuilder.build(p, 3, options)).toEqual(
      new PureSceneBuilder().build(p, 3, options),
    );
    const scene = buildScene(p, 3, options);
    expect(scene.layers[0]?.transform.x).toBe(10);
    if (scene.layers[0]) scene.layers[0].transform.x = 999;
    expect(p).toEqual(before);
  });
  it('orders bottom-to-top tracks, then start/id, independently of record insertion', () => {
    const p = project(
      [clip('z'), clip('b'), clip('a'), clip('top', { trackId: 'o' })],
      [track('v'), track('o')],
    );
    expect(buildScene(p, 3).layers.map((l) => l.clipId)).toEqual([
      'a',
      'b',
      'z',
      'top',
    ]);
  });
  it('does not confuse hidden, locked and muted with each other', () => {
    const p = project(
      [clip('c')],
      [track('v', { hidden: true, locked: true })],
    );
    expect(buildScene(p, 3).layers).toHaveLength(0);
    expect(buildScene(p, 3).audio[0]?.muted).toBe(false);
    p.tracks[0] = track('v', { muted: true });
    expect(buildScene(p, 3).layers).toHaveLength(1);
    expect(buildScene(p, 3).audio[0]?.gain).toBe(0);
  });
  it('preserves animation, caption words and source continuity after repeated splits', () => {
    const c = clip('c', {
      kind: 'text',
      keyframes: [
        { property: 'x', time: 0, value: 0 },
        { property: 'x', time: 8, value: 80 },
      ],
      text: {
        content: 'hello world',
        style: 'caption-pop',
        words: [{ t: 4, d: 2, w: 'world' }],
      },
    });
    const p = project([c]);
    const split = applyOps(p, [
      { op: 'clip.split', id: 'c', at: 4, newId: 'r' },
      { op: 'clip.split', id: 'r', at: 6, newId: 'rr' },
    ]);
    const before = buildScene(p, 7).layers[0],
      after = buildScene(split, 7).layers[0];
    expect(after?.sourceTime).toBe(before?.sourceTime);
    expect(after?.transform).toEqual(before?.transform);
    expect(after?.text).toEqual(before?.text);
    expect(after?.animationTime).toBe(5);
    expect(animationTime(c, 7)).toBe(5);
  });
  it('supports portrait dimensions, crop and degree rotation without inventing fit metrics', () => {
    const c = clip('c', {
      transform: {
        x: 10,
        y: -20,
        scale: 1.5,
        rotation: 90,
        opacity: 1,
        crop: { l: 0.1, t: 0.2, r: 0.1, b: 0 },
      },
    });
    const p = { ...project([c]), width: 1080 as const, height: 1920 as const };
    const scene = buildScene(p, 3, options);
    expect(scene).toMatchObject({ width: 1080, height: 1920, frame: 90 });
    expect(scene.layers[0]?.transform).toEqual(c.transform);
    expect(scene.layers[0]?.crop).toEqual(c.transform.crop);
  });
  it('rejects invalid clocks/master and exposes orphan track rather than fabricating order', () => {
    expect(() => buildScene(project([]), NaN)).toThrow(RangeError);
    expect(() =>
      buildScene(project([]), 1, { masterVolume: Infinity }),
    ).toThrow(RangeError);
    expect(
      buildScene(project([clip('c', { trackId: 'missing' })]), 3)
        .approximations[0]?.reason,
    ).toContain('track');
  });
});
describe('keyframe interpolation matrix', () => {
  const keys = (
    easing?: Clip['keyframes'][number]['easing'],
  ): Clip['keyframes'] => [
    { property: 'x', time: 0, value: 0, easing },
    { property: 'x', time: 4, value: 100 },
  ];
  it.each([
    [-1, 0],
    [0, 0],
    [1, 25],
    [2, 50],
    [4, 100],
    [10, 100],
  ])('linear endpoints at %s', (t, expected) => {
    expect(interpolateKeyframes(keys(), t, 9)).toBe(expected);
  });
  it.each([
    [0, 0],
    [3.999, 0],
    [4, 100],
    [5, 100],
  ])('hold endpoints at %s', (t, expected) => {
    expect(interpolateKeyframes(keys('hold'), t, 9)).toBe(expected);
  });
  it.each([
    ['ease_in_out', 6.25],
    ['ease_out', 57.8125],
  ] as const)('resolves %s cubic', (easing, expected) => {
    expect(interpolateKeyframes(keys(easing), 1, 9)).toBe(expected);
  });
  it('inverts bezier x, does not interpolate directly on the bezier parameter', () => {
    const k = keys('bezier');
    if (k[0]) k[0].bezier = [0.25, 0.1, 0.25, 1];
    expect(interpolateKeyframes(k, 2, 0)).toBeCloseTo(80.2403, 3);
    expect(interpolateKeyframes(k, 0, 0)).toBe(0);
    expect(interpolateKeyframes(k, 4, 0)).toBe(100);
  });
  it('empty keys retain base, duplicate times last wins, keys override opacity base', () => {
    expect(interpolateKeyframes([], 2, 0.8)).toBe(0.8);
    expect(
      interpolateKeyframes(
        [...keys(), { property: 'x', time: 0, value: 20 }],
        0,
        0,
      ),
    ).toBe(20);
    const c = clip('c', {
      keyframes: [{ property: 'opacity', time: 0, value: 1 }],
    });
    expect(layer(c)?.opacity).toBe(1);
  });
});
describe('bounded transition formulas', () => {
  it('prefers frame duration and supports legacy seconds including cut/zero', () => {
    expect(
      transitionDuration(
        { kind: 'slide', durationFrames: 15, duration: 7 },
        30,
      ),
    ).toBe(0.5);
    expect(transitionDuration({ kind: 'crossfade', duration: 0.7 }, 30)).toBe(
      0.7,
    );
    expect(
      layer(clip('c', { transitionIn: { kind: 'cut', duration: 2 } }), 2)
        ?.opacity,
    ).toBe(0.8);
    expect(
      layer(clip('c', { transitionIn: { kind: 'dip', durationFrames: 0 } }), 2)
        ?.transitions,
    ).toEqual([]);
  });
  it.each(['crossfade', 'dip'] as const)(
    '%s resolves in/out opacity at endpoints and midpoint',
    (kind) => {
      const c = clip('c', {
        transitionIn: { kind, durationFrames: 60 },
        transitionOut: { kind, duration: 2 },
      });
      expect(layer(c, 2)?.opacity).toBe(0);
      expect(layer(c, 3)?.opacity).toBeCloseTo(0.4);
      expect(layer(c, 4)?.opacity).toBe(0.8);
      expect(layer(c, 8)?.opacity).toBe(0.8);
      expect(layer(c, 9)?.opacity).toBeCloseTo(0.4);
      expect(layer(c, 10)).toBeUndefined();
      expect(layer(c, 3)?.approximations.join(' ')).toContain(
        'paired source handles',
      );
    },
  );
  it.each([
    ['left', 1920, 0],
    ['right', -1920, 0],
    ['up', 0, 1080],
    ['down', 0, -1080],
  ] as const)('slide %s entry and exit displacement', (direction, x, y) => {
    const c = clip('c', {
      transitionIn: { kind: 'slide', direction, duration: 2 },
      transitionOut: { kind: 'slide', direction, duration: 2 },
    });
    expect(layer(c, 2)?.transform).toMatchObject({ x, y });
    expect(layer(c, 3)?.transform).toMatchObject({ x: x / 2, y: y / 2 });
    expect(layer(c, 9)?.transform).toMatchObject({
      x: -x / 2 || 0,
      y: -y / 2 || 0,
    });
  });
  it('zoom and whip expose concrete scale and deterministic motion blur descriptors', () => {
    expect(
      layer(clip('z', { transitionIn: { kind: 'zoom_in', duration: 2 } }), 2)
        ?.transform.scale,
    ).toBe(1.15);
    expect(
      layer(clip('z', { transitionIn: { kind: 'zoom_in', duration: 2 } }), 3)
        ?.transform.scale,
    ).toBe(1.075);
    const c = clip('w', {
      transitionIn: { kind: 'whip', direction: 'up', duration: 2 },
    });
    expect(layer(c, 2)?.transitions[0]?.blurPx).toBe(0);
    expect(layer(c, 3)?.transitions[0]?.blurPx).toBe(64);
    expect(layer(c, 4)?.transitions).toEqual([]);
  });
  it('composes overlapping entry/exit factors deterministically for short clips', () => {
    const c = clip('c', {
      duration: 1,
      transitionIn: { kind: 'crossfade', duration: 2 },
      transitionOut: { kind: 'dip', duration: 2 },
    });
    expect(layer(c, 2.5)?.opacity).toBeCloseTo(0.2);
    expect(layer(c, 2.5)?.transitions).toHaveLength(2);
  });
});
describe('effect/mask/shape/text descriptors', () => {
  it('keeps effect order, scalar keys and normalized scopes; flags unknown effects', () => {
    const c = clip('c', {
      effects: [
        {
          id: 'blur',
          kind: 'blur',
          params: { sigma: 2 },
          scope: 'outside_mask',
        },
        { id: 'future', kind: 'heavy_3d', params: { model: 'x' } },
      ],
      keyframes: [{ property: 'effects.blur.sigma', time: 0, value: 3 }],
    });
    const l = layer(c);
    expect(l?.effects).toEqual([
      { id: 'blur', kind: 'blur', scope: 'outside_mask', params: { sigma: 3 } },
      { id: 'future', kind: 'heavy_3d', scope: 'all', params: { model: 'x' } },
    ]);
    expect(l?.approximations).toContain('Scoped effect blur has no mask');
    expect(l?.approximations).toContain('Unsupported effect: heavy_3d');
  });
  it.each(['rle', 'video', 'luma_image'] as const)(
    'aligns %s mask to source not timeline and preserves invert',
    (encoding) => {
      const mask: NonNullable<Asset['mask']> =
        encoding === 'rle'
          ? {
              encoding,
              width: 2,
              height: 2,
              fps: 24,
              timeOrigin: 2,
              coordinateSpace: 'source_uv',
              channel: 'luma',
              version: 1,
              payloadUrl: '/rle',
            }
          : encoding === 'video'
            ? {
                encoding,
                width: 2,
                height: 2,
                fps: 24,
                timeOrigin: 2,
                coordinateSpace: 'source_uv',
                channel: 'red',
              }
            : {
                encoding,
                width: 2,
                height: 2,
                coordinateSpace: 'source_uv',
                channel: 'luma',
              };
      const c = clip('c', {
        mask: {
          kind: 'sam',
          maskAssetId: 'm',
          invert: true,
          feather: 0,
          mode: 'cutout',
        },
      });
      const l = buildScene(project([c]), 3, {
        assets: { a: asset, m: { ...asset, id: 'm', mask } },
      }).layers[0];
      expect(l?.mask).toMatchObject({
        assetId: 'm',
        sourceTime: 5,
        invert: true,
        mode: 'cutout',
        metadata: mask,
      });
      expect(l?.mask?.frameIndex).toBe(
        encoding === 'luma_image' ? undefined : 72,
      );
      expect(l?.approximations).toEqual([]);
    },
  );
  it('reports absent mask/LUT/shape metadata instead of inventing it', () => {
    const c = clip('c', {
      kind: 'shape',
      mask: { kind: 'sam', maskAssetId: 'm', invert: false, feather: 0.1 },
      effects: [{ id: 'lut', kind: 'lut', params: { lutAssetId: 'l' } }],
    });
    const l = layer(c);
    expect(l?.shape).toBeUndefined();
    expect(l?.approximations).toContain('Shape geometry unavailable');
    expect(l?.approximations).toContain('Mask encoding metadata unavailable');
    expect(l?.approximations).toContain('LUT atlas metadata unavailable');
  });
  it('passes exact supplied rect/line geometry and preserves zoom-punch envelope', () => {
    const shapes: NonNullable<Clip['shape']>[] = [
      { kind: 'rect', width: 40, height: 20, fill: [0, 0, 0, 1], radius: 8 },
      {
        kind: 'line',
        x1: 0,
        y1: 0,
        x2: 40,
        y2: 20,
        stroke: [1, 1, 1, 1],
        strokeWidth: 2,
      },
    ];
    for (const shape of shapes)
      expect(layer(clip('s', { kind: 'shape', shape }))?.shape).toEqual(shape);
    const c = clip('z', {
      effects: [
        {
          id: 'z',
          kind: 'zoom_punch',
          params: { amount: 0.2, attack: 1, release: 1 },
        },
      ],
    });
    expect(layer(c, 2)?.transform.scale).toBe(1);
    expect(layer(c, 2.5)?.transform.scale).toBe(1.1);
    expect(layer(c, 3)?.transform.scale).toBe(1.2);
    expect(layer(c, 9.5)?.transform.scale).toBe(1.1);
  });
});
describe('integration boundary regressions', () => {
  it('normalizes zoom_punch_in as the renderer alias without dropping the descriptor', () => {
    const c = clip('z', {
      effects: [
        {
          id: 'z',
          kind: 'zoom_punch_in',
          params: { amount: 0.2, attack: 1, release: 1 },
        },
      ],
    });
    const l = layer(c, 3);
    expect(l?.transform.scale).toBe(1.2);
    expect(l?.effects[0]?.kind).toBe('zoom_punch_in');
    expect(l?.approximations).toEqual([]);
  });
  it('does not invent mask frames before origin or normalize invalid legacy crop away', () => {
    const c = clip('c', {
      mask: {
        kind: 'sam',
        maskAssetId: 'm',
        mode: 'selection',
        invert: false,
        feather: 0,
      },
      transform: {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        crop: { l: 20, r: 10, t: 0, b: 0 },
      },
    });
    const m: Asset = {
      ...asset,
      id: 'm',
      mask: {
        encoding: 'video',
        width: 2,
        height: 2,
        fps: 30,
        timeOrigin: 10,
        channel: 'luma',
        coordinateSpace: 'source_uv',
      },
    };
    const l = buildScene(project([c]), 3, { assets: { a: asset, m } })
      .layers[0];
    expect(l?.mask?.frameIndex).toBe(-150);
    expect(l?.crop).toEqual(c.transform.crop);
    expect(l?.approximations).toContain('Mask time precedes encoded range');
    expect(l?.approximations).toContain(
      'Crop units or bounds require server agreement',
    );
  });
  it('holds frame-duration transition boundaries and animation offset entry behavior', () => {
    const c = clip('c', {
      transitionIn: { kind: 'crossfade', durationFrames: 15 },
    });
    expect(layer(c, 2)?.opacity).toBe(0);
    expect(layer(c, 2.25)?.opacity).toBeCloseTo(0.4);
    expect(layer(c, 2.5)?.opacity).toBe(0.8);
    expect(layer({ ...c, animationOffsetSec: 1 }, 2)?.transitions).toEqual([]);
  });
  it('resolves easing and bezier volume fades on the animation clock, not source time', () => {
    const c = clip('a', {
      kind: 'audio',
      audioRole: 'voice',
      animationOffsetSec: 1,
      keyframes: [
        {
          property: 'volume',
          time: 0,
          value: 0,
          easing: 'bezier',
          bezier: [0.25, 0.1, 0.25, 1],
        },
        { property: 'volume', time: 4, value: 1 },
      ],
    });
    expect(buildScene(project([c]), 3).audio[0]?.gain).toBeCloseTo(0.802403, 5);
  });
  it('new live WS keyframe and track schemas survive reducer application without default injection', () => {
    const p = project([clip('c')]);
    const next = applyOps(p, [
      {
        op: 'clip.update',
        id: 'c',
        patch: { animationOffsetSec: 2, audioRole: 'music' },
      },
      { op: 'track.update', id: 'v', patch: { solo: true } },
      {
        op: 'keyframe.set',
        clipId: 'c',
        keyframe: { property: 'x', time: 0, value: 0, easing: 'hold' },
      },
      {
        op: 'keyframe.set',
        clipId: 'c',
        keyframe: { property: 'x', time: 4, value: 40 },
      },
    ]);
    const scene = buildScene(next, 3, options);
    expect(scene.layers[0]?.transform.x).toBe(0);
    expect(scene.audio[0]).toMatchObject({ role: 'music', muted: false });
    expect(next.clips.c?.animationOffsetSec).toBe(2);
    expect(p.clips.c?.animationOffsetSec).toBeUndefined();
  });
});
describe('audio volumes, fades, roles, gates and interrupted ducking', () => {
  it('resolves hidden video audio and keyframed fades at source speed independent of master', () => {
    const c = clip('a', {
      kind: 'audio',
      volume: 0.8,
      keyframes: [
        { property: 'volume', time: 0, value: 0 },
        { property: 'volume', time: 2, value: 1 },
      ],
    });
    const scene = buildScene(project([c]), 3, { masterVolume: 0.5 });
    expect(scene.layers).toEqual([]);
    expect(scene.audio[0]).toMatchObject({
      sourceTime: 5,
      playbackRate: 2,
      gain: 0.25,
      role: 'other',
      duckGain: 1,
    });
  });
  it('solo gates all non-solo audio-producing tracks and mute wins over solo', () => {
    const p = project(
      [
        clip('a', { trackId: 'a' }),
        clip('b', { trackId: 'b' }),
        clip('c', { trackId: 'c' }),
      ],
      [
        track('a', { solo: true }),
        track('b'),
        track('c', { solo: true, muted: true }),
      ],
    );
    expect(buildScene(p, 3).audio.map((a) => a.gain)).toEqual([1, 0, 0]);
    expect(buildScene(p, 3).layers).toHaveLength(3);
  });
  it('computes -12 dB with 300ms attack/release and overlapping voices do not reset ramps', () => {
    const voices = [
      clip('v', { start: 1, duration: 1 }),
      clip('v2', { start: 1.1, duration: 1 }),
    ];
    const low = 10 ** (-12 / 20);
    expect(duckGainAt(voices, 0)).toBe(1);
    expect(duckGainAt(voices, 1)).toBe(1);
    expect(duckGainAt(voices, 1.15)).toBeCloseTo((1 + low) / 2);
    expect(duckGainAt(voices, 1.3)).toBeCloseTo(low);
    expect(duckGainAt(voices, 2.1)).toBeCloseTo(low);
    expect(duckGainAt(voices, 2.25)).toBeCloseTo((1 + low) / 2);
    expect(duckGainAt(voices, 2.4)).toBeCloseTo(1);
  });
  it('interrupted attack releases continuously and only typed audible voices trigger ducking', () => {
    const voices = [clip('v', { start: 1, duration: 0.1 })];
    const atEnd = 1 + (10 ** (-12 / 20) - 1) / 3;
    expect(duckGainAt(voices, 1.1)).toBeCloseTo(atEnd);
    expect(duckGainAt(voices, 1.25)).toBeCloseTo((1 + atEnd) / 2);
    const p = project(
      [
        clip('m', { audioRole: 'music' }),
        clip('v', { trackId: 'voice', audioRole: 'voice' }),
      ],
      [track('v'), track('voice', { muted: true })],
    );
    expect(buildScene(p, 3).audio[0]?.gain).toBe(1);
    p.tracks[1] = track('voice');
    expect(buildScene(p, 3).audio[0]?.gain).toBeCloseTo(10 ** (-12 / 20));
  });
});

describe('paired butt-cut transitions with explicit source handles', () => {
  const c = (
    id: string,
    start: number,
    sourceIn: number,
    patch: Partial<Clip> = {},
  ) =>
    clip(id, {
      start,
      duration: 7,
      in: sourceIn,
      speed: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      ...patch,
    });
  const p = () =>
    project([
      c('c1', 0, 0),
      c('c2', 7, 4, {
        transitionIn: { kind: 'crossfade', durationFrames: 30 },
      }),
      c('c3', 14, 8, {
        transitionIn: { kind: 'crossfade', durationFrames: 30 },
      }),
    ]);
  it.each([
    [6.499, 0, ['c1']],
    [6.5, 1, ['c1', 'c2']],
    [7, 1, ['c1', 'c2']],
    [7.499, 1, ['c1', 'c2']],
    [7.5, 0, ['c2']],
    [13.5, 1, ['c2', 'c3']],
    [14, 1, ['c2', 'c3']],
    [14.5, 0, ['c3']],
  ] as const)(
    'resolves centered interval at %s without a fade-from-black tail',
    (t, count, ids) => {
      const scene = buildScene(p(), t, options);
      expect(scene.transitionPairs).toHaveLength(count);
      expect(scene.layers.map((l) => l.clipId)).toEqual(ids);
      expect(scene.layers.every((l) => l.opacity === 1)).toBe(true);
      expect(scene.approximations).toEqual([]);
    },
  );
  it('samples both handles through the cut, without extending project timing or audio visibility', () => {
    const original = p(),
      before = structuredClone(original);
    const scene = buildScene(original, 7.25, options);
    expect(scene.transitionPairs?.[0]).toMatchObject({
      outgoingClipId: 'c1',
      incomingClipId: 'c2',
      start: 6.5,
      end: 7.5,
      boundary: 7,
      progress: 0.75,
      compositeAtClipId: 'c2',
      composite: 'premultiplied_mix',
      outgoingWeight: 0.25,
      incomingWeight: 0.75,
      blackWeight: 0,
    });
    expect(scene.layers.map((l) => l.sourceTime)).toEqual([7.25, 4.25]);
    expect(scene.layers.map((l) => l.transitionSample?.mode)).toEqual([
      'handle',
      'handle',
    ]);
    expect(scene.audio.map((l) => l.clipId)).toEqual(['c2']);
    expect(original).toEqual(before);
  });
  it('provides a coherent premultiplied blend with no spurious background leakage', () => {
    const pair = buildScene(p(), 7, options).transitionPairs?.[0];
    if (!pair) throw new Error('pair expected');
    const outgoing = [1, 0, 0, 1],
      incoming = [0, 0, 1, 1];
    const rgba = outgoing.map(
      (v, i) =>
        pair.outgoingWeight * v +
        pair.incomingWeight * (incoming[i] ?? 0) +
        pair.blackWeight * (i === 3 ? 1 : 0),
    );
    expect(rgba).toEqual([0.5, 0, 0.5, 1]);
    expect(1 - (rgba[3] ?? 0)).toBe(0); // underlay weight after ONE source-over
    expect(buildScene(p(), 7, options).layers.map((l) => l.opacity)).toEqual([
      1, 1,
    ]);
  });
  it('freezes unavailable incoming preroll at its actual first sample with a warning', () => {
    const projectWithMissingHandle = project([
      c('a', 0, 0),
      c('b', 7, 0, { transitionIn: { kind: 'crossfade', duration: 1 } }),
    ]);
    const scene = buildScene(projectWithMissingHandle, 6.75, options);
    const incoming = scene.layers.find((l) => l.clipId === 'b');
    expect(incoming).toMatchObject({
      sourceTime: 0,
      localTime: 0,
      animationTime: 0,
      transitionSample: {
        mode: 'boundary',
        requestedSourceTime: -0.25,
        sampleTimelineTime: 7,
        boundary: 'start',
      },
    });
    expect(incoming?.approximations).toContain(
      'Incoming transition preroll unavailable; frozen first boundary frame',
    );
    expect(scene.layers[0]?.sourceTime).toBe(6.75);
  });
  it('freezes unavailable outgoing postroll at last actual boundary frame, using explicit source fps', () => {
    const original = project([
      c('a', 0, 0),
      c('b', 7, 4, { transitionIn: { kind: 'crossfade', duration: 1 } }),
    ]);
    const assets = { a: { ...asset, durationSec: 7 } };
    const scene = buildScene(original, 7.25, { assets, sourceFps: { a: 24 } });
    const outgoing = scene.layers[0];
    expect(outgoing?.sourceTime).toBeCloseTo(167 / 24);
    expect(outgoing?.sourceTime).toBeLessThan(7);
    expect(outgoing?.transitionSample).toMatchObject({
      mode: 'boundary',
      requestedSourceTime: 7.25,
      boundary: 'end',
    });
    expect(outgoing?.approximations).toContain(
      'Outgoing transition postroll unavailable; frozen last boundary frame',
    );
    expect(scene.layers[1]?.sourceTime).toBe(4.25);
  });
  it('does not invent unknown postroll and freezes fractional source endpoints to the last source frame', () => {
    const original = project([
      c('a', 0, 0, { speed: 0.5 }),
      c('b', 7, 1, { transitionIn: { kind: 'crossfade', duration: 1 } }),
    ]);
    const scene = buildScene(original, 7.25, {
      assets: { a: { ...asset, durationSec: undefined } },
      sourceFps: { a: 30 },
    });
    expect(scene.layers[0]?.sourceTime).toBeCloseTo(104 / 30); // source end3.5 is exclusive
    expect(scene.layers[0]?.transitionSample?.mode).toBe('boundary');
    expect(scene.layers[0]?.approximations.join(' ')).toContain(
      'postroll unavailable',
    );
  });
  it('coalesces duplicate pair declarations and flags conflicts instead of double-fading', () => {
    const original = project([
      c('a', 0, 0, { transitionOut: { kind: 'crossfade', duration: 1 } }),
      c('b', 7, 4, { transitionIn: { kind: 'crossfade', durationFrames: 30 } }),
    ]);
    expect(buildScene(original, 7, options).transitionPairs).toHaveLength(1);
    expect(buildScene(original, 7, options).approximations).toEqual([]);
    original.clips.a = {
      ...c('a', 0, 0),
      transitionOut: { kind: 'dip', duration: 2 },
    };
    const scene = buildScene(original, 7, options);
    expect(scene.transitionPairs?.[0]?.kind).toBe('crossfade');
    expect(
      scene.approximations.some((a) =>
        a.reason.includes('Conflicting transition pair'),
      ),
    ).toBe(true);
  });
  it.each(['dip', 'slide', 'zoom_in', 'whip'] as const)(
    'pairs %s without a generic known-feature approximation',
    (kind) => {
      const original = project([
        c('a', 0, 0),
        c('b', 7, 4, {
          transitionIn: { kind, duration: 1, direction: 'left' },
        }),
      ]);
      const scene = buildScene(original, 7, options),
        pair = scene.transitionPairs?.[0];
      expect(pair?.kind).toBe(kind);
      expect(scene.approximations).toEqual([]);
      if (kind === 'dip')
        expect(pair).toMatchObject({
          outgoingWeight: 0,
          incomingWeight: 0,
          blackWeight: 1,
        });
      if (kind === 'slide' || kind === 'whip') {
        expect(pair?.composite).toBe('source_over');
        expect(scene.layers.map((l) => l.transform.x)).toEqual([-960, 960]);
      }
      if (kind === 'zoom_in')
        expect(scene.layers[1]?.transform.scale).toBe(1.075);
      if (kind === 'whip')
        expect(scene.layers[0]?.transitions[0]?.blurPx).toBe(64);
    },
  );
  it.each([
    [6.5, 1, 0, 0],
    [6.75, 0.5, 0, 0.5],
    [7, 0, 0, 1],
    [7.25, 0, 0.5, 0.5],
  ] as const)(
    'dip coefficients resolve opaque black at %s',
    (t, outgoingWeight, incomingWeight, blackWeight) => {
      const original = project([
        c('a', 0, 0),
        c('b', 7, 4, { transitionIn: { kind: 'dip', duration: 1 } }),
      ]);
      expect(
        buildScene(original, t, options).transitionPairs?.[0],
      ).toMatchObject({ outgoingWeight, incomingWeight, blackWeight });
      expect(outgoingWeight + incomingWeight + blackWeight).toBe(1);
    },
  );
  it('never pairs across tracks or gaps, and outgoing-only declarations can pair a butt cut', () => {
    const across = project(
      [
        c('a', 0, 0),
        c('b', 7, 4, {
          trackId: 'o',
          transitionIn: { kind: 'crossfade', duration: 1 },
        }),
      ],
      [track('v'), track('o')],
    );
    expect(buildScene(across, 7, options).transitionPairs).toEqual([]);
    const gap = project([
      c('a', 0, 0),
      c('b', 8, 4, { transitionIn: { kind: 'crossfade', duration: 1 } }),
    ]);
    expect(buildScene(gap, 8, options).transitionPairs).toEqual([]);
    const outOnly = project([
      c('a', 0, 0, { transitionOut: { kind: 'crossfade', duration: 1 } }),
      c('b', 7, 4),
    ]);
    expect(buildScene(outOnly, 7, options).transitionPairs).toHaveLength(1);
  });
  it('rejects invalid explicit source fps and leaves regular source-time math untouched', () => {
    expect(() =>
      buildScene(p(), 7, { ...options, sourceFps: { a: 0 } }),
    ).toThrow(RangeError);
    expect(buildScene(p(), 5, options).layers[0]?.sourceTime).toBe(5);
  });
});

describe('mock 0.3-second pairs and split-transition preservation', () => {
  const video = (id: string, start: number, patch: Partial<Clip> = {}) =>
    clip(id, {
      start,
      duration: 7,
      in: 0,
      speed: 1,
      assetId: `asset-${id}`,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      keyframes: [
        { property: 'x', time: 0, value: 0 },
        { property: 'x', time: 7, value: 70 },
      ],
      ...patch,
    });
  const clips = () => [
    video('c3', 0, { transitionOut: { kind: 'crossfade', duration: 0.3 } }),
    video('c2', 7, {
      transitionIn: { kind: 'crossfade', duration: 0.3 },
      transitionOut: { kind: 'crossfade', duration: 0.3 },
    }),
    video('c1', 14, { transitionIn: { kind: 'crossfade', duration: 0.3 } }),
  ];
  const assets = Object.fromEntries(
    ['c3', 'c2', 'c1'].map((id) => [
      `asset-${id}`,
      { ...asset, id: `asset-${id}`, durationSec: 8 },
    ]),
  );
  const opts = { assets };
  it.each([
    [6.849999, 0],
    [6.85, 1],
    [6.999999, 1],
    [7, 1],
    [7.000001, 1],
    [7.149999, 1],
    [7.15, 0],
    [13.849999, 0],
    [13.85, 1],
    [14, 1],
    [14.15, 0],
  ] as const)('actual mock pair endpoints at %s', (t, count) => {
    const scene = buildScene(project(clips()), t, opts);
    expect(scene.transitionPairs).toHaveLength(count);
    expect(scene.layers.every((l) => l.opacity === 1)).toBe(true);
    for (const l of scene.layers) {
      expect(l.sourceTime).toBeGreaterThanOrEqual(0);
      expect(l.sourceTime).toBeLessThan(8);
    }
  });
  it('uses the genuine outgoing 1-second handle and frozen incoming first frame, not black', () => {
    const p = project(clips());
    const before = buildScene(p, 6.925, opts),
      at = buildScene(p, 7, opts),
      after = buildScene(p, 7.075, opts);
    expect(before.transitionPairs?.[0]?.progress).toBeCloseTo(0.25);
    expect(before.layers[1]).toMatchObject({
      sourceTime: 0,
      transitionRole: 'incoming',
      transitionSample: { mode: 'boundary' },
    });
    expect(before.layers[0]?.sourceTime).toBeCloseTo(6.925);
    expect(at.transitionPairs?.[0]?.progress).toBeCloseTo(0.5);
    expect(at.layers.map((l) => l.sourceTime)).toEqual([7, 0]);
    expect(after.transitionPairs?.[0]?.progress).toBeCloseTo(0.75);
    expect(after.layers[0]?.sourceTime).toBeCloseTo(7.075);
    expect(after.layers[0]?.transitionSample?.mode).toBe('handle');
    expect(after.layers[1]?.sourceTime).toBeCloseTo(0.075);
    expect(after.approximations).toEqual([]);
  });
  it('splitting inside the incoming transition preserves pair duration, weights, animation and samples', () => {
    const p = project(clips());
    const split = applyOps(p, [
      { op: 'clip.split', id: 'c2', at: 7.05, newId: 'c2-right' },
    ]);
    for (const t of [
      6.85, 6.95, 7, 7.049, 7.05, 7.1, 7.149, 7.15, 10, 13.95, 14,
    ]) {
      const before = buildScene(p, t, opts),
        after = buildScene(split, t, opts);
      expect(
        after.transitionPairs?.map((pair) => ({
          id: pair.id,
          start: pair.start,
          end: pair.end,
          progress: pair.progress,
          a: pair.outgoingWeight,
          b: pair.incomingWeight,
          black: pair.blackWeight,
        })),
      ).toEqual(
        before.transitionPairs?.map((pair) => ({
          id: pair.id,
          start: pair.start,
          end: pair.end,
          progress: pair.progress,
          a: pair.outgoingWeight,
          b: pair.incomingWeight,
          black: pair.blackWeight,
        })),
      );
      expect(
        after.layers.map((l) => ({
          source: l.sourceTime,
          transform: l.transform,
          opacity: l.opacity,
          clock: l.animationTime,
        })),
      ).toEqual(
        before.layers.map((l) => ({
          source: l.sourceTime,
          transform: l.transform,
          opacity: l.opacity,
          clock: l.animationTime,
        })),
      );
    }
    expect(
      buildScene(split, 7.1, opts).transitionPairs?.[0]?.incomingClipId,
    ).toBe('c2-right');
    expect(
      buildScene(split, 14, opts).transitionPairs?.[0]?.outgoingClipId,
    ).toBe('c2-right');
    expect(
      buildScene(split, 7.05, opts).transitionPairs?.[0]?.durationSec,
    ).toBe(0.3);
    expect(p.clips['c2-right']).toBeUndefined();
  });
  it('repeated splits do not create extra inherited transitions at internal cuts', () => {
    const p = project(clips());
    const split = applyOps(p, [
      { op: 'clip.split', id: 'c3', at: 3, newId: 'c3b' },
      { op: 'clip.split', id: 'c3b', at: 6.98, newId: 'c3c' },
      { op: 'clip.split', id: 'c2', at: 10, newId: 'c2b' },
    ]);
    for (const t of [
      2.9, 3, 3.1, 6.95, 6.98, 7, 7.1, 9.95, 10, 10.1, 13.95, 14, 14.1,
    ]) {
      const a = buildScene(p, t, opts),
        b = buildScene(split, t, opts);
      expect(
        b.transitionPairs?.map((pair) => [
          pair.id,
          pair.progress,
          pair.durationSec,
        ]),
      ).toEqual(
        a.transitionPairs?.map((pair) => [
          pair.id,
          pair.progress,
          pair.durationSec,
        ]),
      );
      expect(
        b.layers.map((l) => [l.sourceTime, l.opacity, l.transform.x]),
      ).toEqual(a.layers.map((l) => [l.sourceTime, l.opacity, l.transform.x]));
    }
    expect(buildScene(split, 3, opts).transitionPairs).toEqual([]);
    expect(buildScene(split, 10, opts).transitionPairs).toEqual([]);
  });
  it('split outgoing freeze uses original source boundary, including a final sub-frame fragment', () => {
    const p = project(clips()),
      shortAssets = {
        ...assets,
        'asset-c3': { ...asset, id: 'asset-c3', durationSec: 7 },
      };
    const split = applyOps(p, [
      { op: 'clip.split', id: 'c3', at: 6.99, newId: 'last-fragment' },
    ]);
    const a = buildScene(p, 7.05, { assets: shortAssets }),
      b = buildScene(split, 7.05, { assets: shortAssets });
    expect(b.layers[0]?.sourceTime).toBe(a.layers[0]?.sourceTime);
    expect(b.layers[0]?.transform).toEqual(a.layers[0]?.transform);
    expect(b.layers[0]?.transitionSample?.mode).toBe('boundary');
    expect(b.layers[0]?.clipId).toBe('last-fragment');
  });
  it('preserves standalone in/out animation clocks and zoom-punch envelope through split', () => {
    const c = video('c3', 0, {
      transitionIn: { kind: 'crossfade', duration: 1 },
      transitionOut: { kind: 'dip', duration: 1 },
      effects: [
        {
          id: 'z',
          kind: 'zoom_punch',
          params: { amount: 0.2, attack: 1, release: 1 },
        },
      ],
    });
    const p = project([c]),
      split = applyOps(p, [
        { op: 'clip.split', id: 'c3', at: 3, newId: 'right' },
      ]);
    for (const t of [0, 0.5, 1, 2.9, 3, 3.1, 5.9, 6, 6.5, 6.999]) {
      const a = buildScene(p, t, opts),
        b = buildScene(split, t, opts);
      expect(b.transitionPairs).toEqual([]);
      expect(b.layers[0]?.opacity).toBeCloseTo(a.layers[0]?.opacity ?? 0);
      expect(b.layers[0]?.transform).toEqual(a.layers[0]?.transform);
      expect(b.layers[0]?.sourceTime).toBe(a.layers[0]?.sourceTime);
    }
  });
  it('does not collapse an explicit changed transition or discontinuous source into a split group', () => {
    const p = project(clips());
    const split = applyOps(p, [
      { op: 'clip.split', id: 'c2', at: 10, newId: 'right' },
      {
        op: 'clip.update',
        id: 'right',
        patch: { transitionIn: { kind: 'dip', duration: 0.3 } },
      },
    ]);
    expect(buildScene(split, 10, opts).transitionPairs?.[0]?.kind).toBe('dip');
    const discontinuous = applyOps(p, [
      { op: 'clip.split', id: 'c2', at: 10, newId: 'right' },
      { op: 'clip.update', id: 'right', patch: { in: 4 } },
    ]);
    expect(buildScene(discontinuous, 10, opts).transitionPairs).toHaveLength(1);
  });
});

describe('Phase 7 renderer consumer fields', () => {
  it('keeps ordered enabled effects, ignores disabled transforms and filters, and carries project RGBA', () => {
    const c = clip('c', {
      effects: [
        {
          id: 'offzoom',
          kind: 'zoom_punch_in',
          enabled: false,
          params: { scale: 2 },
        },
        { id: 'off', kind: 'blur', enabled: false, params: { radius: 10 } },
        { id: 'on', kind: 'grain', enabled: true, params: { amount: 0.3 } },
        { id: 'legacy', kind: 'vignette', params: { strength: 0.5 } },
      ],
    });
    const p = {
      ...project([c]),
      background: [0.2, 0.3, 0.4, 0.5] as [number, number, number, number],
    };
    const scene = buildScene(p, 3, options);
    expect(scene.background).toEqual([0.2, 0.3, 0.4, 0.5]);
    expect(scene.layers[0]?.effects.map((e) => e.id)).toEqual(['on', 'legacy']);
    expect(scene.layers[0]?.transform.scale).toBe(1);
    expect(p.clips.c?.effects).toHaveLength(4);
  });
  it.each(['none', 'fade', 'rise', 'type on', 'pop words'] as const)(
    'consumes %s using the preserved animation clock',
    (animation) => {
      const c = clip('text', {
        kind: 'text',
        start: 0,
        speed: 1,
        text: { style: 'caption-clean', content: 'abcdef', animation },
        animationOffsetSec: 0.1,
      });
      const resolved = buildScene(project([c]), 0, options).layers[0];
      expect(resolved?.text?.content).toBe(
        animation === 'type on' ? 'abc' : 'abcdef',
      );
      expect(resolved?.opacity).toBeCloseTo(
        animation === 'fade' || animation === 'rise' ? 0.4 : 0.8,
        12,
      );
      expect(resolved?.transform.y).toBe(animation === 'rise' ? 12 : 0);
    },
  );
  it('multiplies raw audio fades once and honors duckUnderVoice=false in scene metadata', () => {
    const music = clip('music', {
      kind: 'audio',
      start: 0,
      speed: 1,
      duration: 10,
      audioRole: 'music',
      volume: 0.5,
      fadeInSec: 2,
      duckUnderVoice: false,
    });
    const voice = clip('voice', {
      kind: 'audio',
      start: 0,
      speed: 1,
      audioRole: 'voice',
    });
    const scene = buildScene(project([music, voice]), 1, {
      ...options,
      masterVolume: 0.5,
    });
    expect(scene.audio.find((a) => a.clipId === 'music')).toMatchObject({
      gain: 0.125,
      duckGain: 1,
    });
  });
});

it('ignores a muted solo track for audio gating just like the raw engine', () => {
  const scene = buildScene(
    project(
      [clip('music', { kind: 'audio', audioRole: 'music' })],
      [track('v'), track('muted', { solo: true, muted: true })],
    ),
    3,
    options,
  );
  expect(scene.audio[0]?.muted).toBe(false);
});
