import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, DUCK_GAIN, volumeAt } from './audio-engine';
import { interpolateKeyframes } from './scene-builder';
import type { MediaClip, MediaTrack } from './media-types';

class Param {
  value = 1;
  curves: { values: Float32Array; time: number; duration: number }[] = [];
  setValueCurveAtTime(values: Float32Array, time: number, duration: number) {
    this.curves.push({ values, time, duration });
  }
  calls: { type: string; value?: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.calls.push({ type: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.calls.push({ type: 'ramp', value, time });
  }
  cancelScheduledValues(time: number) {
    this.calls.push({ type: 'cancel', time });
  }
}
class Node {
  gain = new Param();
  playbackRate = new Param();
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class Context {
  currentTime = 0;
  state: AudioContextState = 'running';
  destination = new Node();
  gains: Node[] = [];
  sources: Node[] = [];
  media: Node[] = [];
  elements = new WeakSet<HTMLMediaElement>();
  createGain = () => {
    const node = new Node();
    this.gains.push(node);
    return node;
  };
  createBufferSource = () => {
    const node = new Node();
    this.sources.push(node);
    return node;
  };
  createMediaElementSource = (element: HTMLMediaElement) => {
    if (this.elements.has(element)) throw new Error('Duplicate source');
    this.elements.add(element);
    const node = new Node();
    this.media.push(node);
    return node;
  };
  decodeAudioData = vi.fn(async () => buffer());
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  get context() {
    return this as unknown as AudioContext;
  }
}
function buffer(duration = 20): AudioBuffer {
  return { duration } as AudioBuffer;
}
const tracks: MediaTrack[] = [{ id: 't', muted: false }];
function clip(patch: Partial<MediaClip> = {}): MediaClip {
  return {
    id: 'clip',
    assetId: 'asset',
    trackId: 't',
    kind: 'audio',
    start: 0,
    duration: 10,
    in: 1,
    speed: 1,
    ...patch,
  };
}
function setup() {
  const context = new Context();
  const issues: string[] = [];
  const engine = new AudioEngine({
    context: context.context,
    onIssue: (issue) => issues.push(issue),
  });
  engine.setBuffer('asset', buffer());
  return { engine, context, issues };
}

describe('AudioEngine actual graph operations through injected WebAudio boundary', () => {
  it('schedules one-shot buffer with source in, clip/transport speed and duration', () => {
    const { engine, context } = setup();
    engine.sync([clip({ start: 2, in: 3, speed: 2 })], tracks, 4, {
      playing: true,
      rate: 1.5,
    });
    expect(context.sources[0]?.start).toHaveBeenCalledWith(0, 7, 13);
    expect(context.sources[0]?.playbackRate.calls).toContainEqual({
      type: 'set',
      value: 3,
      time: 0,
    });
    expect(engine.audioTime()).toBe(0);
    engine.dispose();
    expect(context.sources[0]?.stop).toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
  });
  it('schedules future clips in a bounded 1.5s horizon, with no early clock activation', () => {
    const { engine, context } = setup();
    engine.sync(
      [clip({ start: 1 }), clip({ id: 'far', start: 3 })],
      tracks,
      0,
      { playing: true, rate: 2 },
    );
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.start).toHaveBeenCalledWith(0.5, 1, 10);
    expect(engine.audioTime()).toBeNull();
    engine.dispose();
  });
  it('retains running sources on ordinary ticks, restarts on loop/seek/rate change', () => {
    const { engine, context } = setup();
    const clips = [clip()];
    engine.sync(clips, tracks, 0, { playing: true });
    context.currentTime = 0.5;
    engine.sync(clips, tracks, 0.5, { playing: true });
    expect(context.sources).toHaveLength(1);
    context.currentTime = 1;
    engine.sync(clips, tracks, 0.1, { playing: true });
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0]?.stop).toHaveBeenCalledOnce();
    expect(context.sources[1]?.start).toHaveBeenCalledWith(1, 1.1, 9.9);
    engine.sync(clips, tracks, 0.1, { playing: true, rate: 2 });
    expect(context.sources).toHaveLength(3);
    engine.pause();
    expect(engine.audioTime()).toBeNull();
    engine.dispose();
  });
  it('applies linear volume keys and animation offsets instead of multiplying base twice', () => {
    const { engine, context } = setup();
    const c = clip({
      volume: 0.2,
      keyframes: [
        { property: 'volume', time: 0, value: 0 },
        { property: 'volume', time: 2, value: 1 },
      ],
    });
    expect(volumeAt(c, 1)).toBe(0.5);
    expect(volumeAt({ ...c, animationOffsetSec: 1 }, 0)).toBe(0.5);
    engine.sync([c], tracks, 1, { playing: true, rate: 2, master: 0.4 });
    expect(context.gains[0]?.gain.calls).toContainEqual({
      type: 'set',
      value: 0.4,
      time: 0,
    });
    expect(context.gains[1]?.gain.calls).toContainEqual({
      type: 'set',
      value: 0.5,
      time: 0,
    });
    expect(context.gains[1]?.gain.calls).toContainEqual({
      type: 'ramp',
      value: 1,
      time: 0.5,
    });
    engine.dispose();
  });
  it('ducks music -12dB with continuous 300ms interrupted attack and release', () => {
    const { engine, context } = setup();
    const music = clip({ id: 'music', audioRole: 'music' });
    const voice = clip({ id: 'voice', audioRole: 'voice', duration: 0.15 });
    engine.sync([music, voice], tracks, 0, { playing: true });
    const duck = context.gains[2]?.gain;
    expect(duck?.calls).toContainEqual({
      type: 'ramp',
      value: DUCK_GAIN,
      time: 0.3,
    });
    context.currentTime = 0.15;
    engine.sync([music, voice], tracks, 0.15, { playing: true });
    expect(duck?.calls).toContainEqual({
      type: 'set',
      value: 1 + (DUCK_GAIN - 1) * 0.5,
      time: 0.15,
    });
    expect(duck?.calls).toContainEqual({
      type: 'ramp',
      value: 1,
      time: 0.44999999999999996,
    });
    engine.dispose();
  });
  it('gates muted/non-solo tracks, with muted winning even when solo', () => {
    const { engine, context } = setup();
    const t = [
      { id: 't', muted: false },
      { id: 'solo', solo: true, muted: false },
      { id: 'muted', muted: true, solo: true },
    ];
    engine.sync(
      [
        clip(),
        clip({ id: 'solo', trackId: 'solo' }),
        clip({ id: 'muted', trackId: 'muted' }),
      ],
      t,
      0,
      { playing: true },
    );
    expect(context.sources).toHaveLength(1);
    engine.sync([clip()], tracks, 0, { playing: true, master: 0 });
    expect(engine.audioTime()).toBeNull();
    engine.dispose();
  });
  it('creates exactly one element source per physical element/context across pause, reuse and engine disposal', () => {
    const context = new Context();
    const element = document.createElement('video');
    const c = clip({ kind: 'video' });
    const engine = new AudioEngine({ context: context.context });
    engine.sync([c], tracks, 0, { playing: true }, new Map([[c.id, element]]));
    expect(element.muted).toBe(false);
    engine.pause();
    expect(element.muted).toBe(true);
    engine.sync(
      [{ ...c, id: 'reused' }],
      tracks,
      1,
      { playing: true },
      new Map([['reused', element]]),
    );
    expect(context.media).toHaveLength(1);
    engine.dispose();
    const next = new AudioEngine({ context: context.context });
    next.sync([c], tracks, 2, { playing: true }, new Map([[c.id, element]]));
    expect(context.media).toHaveLength(1);
    expect(context.media[0]?.connect).toHaveBeenCalledTimes(3);
    next.dispose();
  });
  it('requires activation and reports rejected resume, without pretending audio is running', async () => {
    const { engine, context, issues } = setup();
    context.state = 'suspended';
    context.resume.mockRejectedValueOnce(new Error('NotAllowedError'));
    expect(await engine.resume()).toBe(false);
    engine.sync([clip()], tracks, 0, { playing: true });
    expect(context.sources).toHaveLength(0);
    expect(engine.audioTime()).toBeNull();
    expect(issues.join()).toContain('activation');
    expect(await engine.resume()).toBe(true);
    engine.dispose();
  });
  it('scrubs 60ms by default from buffers, cancels old blips and does not fake video extraction', () => {
    const { engine, context, issues } = setup();
    expect(engine.scrub([clip({ speed: 2 })], tracks, 1)).toBe(true);
    expect(context.sources[0]?.start).toHaveBeenCalledWith(0, 3, 0.12);
    engine.scrub([clip()], tracks, 2);
    expect(context.sources[0]?.stop).toHaveBeenCalledOnce();
    expect(context.gains[1]?.disconnect).toHaveBeenCalledOnce();
    expect(engine.scrub([clip()], tracks, 2, false)).toBe(false);
    expect(
      engine.scrub(
        [clip({ kind: 'video', assetId: 'video-no-buffer' })],
        tracks,
        2,
      ),
    ).toBe(false);
    expect(issues.join()).toContain('no extracted');
    engine.dispose();
  });
  it('never schedules negative playback rate and cleans blips/nodes on disposal', () => {
    const { engine, context } = setup();
    engine.sync([clip()], tracks, 2, { playing: true, rate: -1 });
    expect(context.sources).toHaveLength(0);
    engine.scrub([clip()], tracks, 2);
    engine.dispose();
    expect(context.sources[0]?.disconnect).toHaveBeenCalled();
    expect(
      context.gains.every((gain) => gain.disconnect.mock.calls.length > 0),
    ).toBe(true);
  });
  it('deduplicates actual fetch/decode and exposes decode failures for retry', async () => {
    const context = new Context();
    const fetcher = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    }));
    const issues: string[] = [];
    const engine = new AudioEngine({
      context: context.context,
      fetch: fetcher as unknown as typeof fetch,
      onIssue: (issue) => issues.push(issue),
    });
    const asset = { id: 'decode', url: '/original', proxyUrl: '/proxy' };
    const a = engine.loadBuffer(asset);
    expect(engine.loadBuffer(asset)).toBe(a);
    await a;
    expect(fetcher).toHaveBeenCalledWith('/proxy', {
      mode: 'cors',
      signal: expect.any(AbortSignal),
    });
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    await engine.loadBuffer(asset);
    expect(fetcher).toHaveBeenCalledOnce();
    context.decodeAudioData.mockRejectedValueOnce(new Error('bad codec'));
    await expect(
      engine.loadBuffer({ ...asset, id: 'bad', proxyUrl: undefined }),
    ).rejects.toThrow('bad codec');
    expect(issues.join()).toContain('decode failed');
    await engine.loadBuffer({ ...asset, id: 'bad', proxyUrl: undefined });
    expect(context.decodeAudioData).toHaveBeenCalledTimes(3);
    engine.dispose();
  });
  it('restarts a playing source when an explicitly replaced decoded buffer becomes ready', () => {
    const { engine, context } = setup();
    engine.sync([clip()], tracks, 0, { playing: true });
    engine.setBuffer('asset', buffer(30));
    engine.sync([clip()], tracks, 0, { playing: true });
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0]?.stop).toHaveBeenCalledOnce();
    engine.dispose();
  });
  it('falls back from proxy decode failure to a real original decode', async () => {
    const context = new Context();
    context.decodeAudioData.mockRejectedValueOnce(
      new Error('Proxy unsupported'),
    );
    const fetcher = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    }));
    const issues: string[] = [];
    const engine = new AudioEngine({
      context: context.context,
      fetch: fetcher as unknown as typeof fetch,
      onIssue: (message) => issues.push(message),
    });
    await engine.loadBuffer({ id: 'a', url: '/original', proxyUrl: '/proxy' });
    expect(fetcher.mock.calls).toHaveLength(2);
    expect(issues.join()).toContain('decoding original');
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    engine.dispose();
  });
  it('restarts sub-frame loops with an explicit clock loop epoch, not a drift heuristic', () => {
    const { engine, context } = setup();
    engine.sync([clip()], tracks, 0, { playing: true, epoch: 0 });
    context.currentTime = 0.016;
    engine.sync([clip()], tracks, 0.006, { playing: true, epoch: 1 });
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0]?.stop).toHaveBeenCalledOnce();
    expect(context.sources[1]?.start).toHaveBeenCalledWith(0.016, 1.006, 9.994);
    engine.dispose();
  });
  it('can audition video only when a real decoded audio buffer was explicitly supplied', () => {
    const { engine, context, issues } = setup();
    const video = clip({ kind: 'video', assetId: 'video' });
    expect(engine.scrub([video], tracks, 2)).toBe(false);
    expect(issues.join()).toContain('no extracted audio buffer');
    engine.setBuffer('video', buffer());
    expect(engine.scrub([video], tracks, 2)).toBe(true);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.start).toHaveBeenCalledWith(0, 3, 0.06);
    expect(context.media).toHaveLength(0);
    engine.dispose();
  });
  it.each(['hold', 'ease_out', 'ease_in_out', 'bezier'] as const)(
    'uses core %s interpolation for volume, offsets and duplicate timestamps',
    (easing) => {
      const keys = [
        { property: 'volume', time: 0, value: 0.2 },
        {
          property: 'volume',
          time: 0,
          value: 0,
          easing,
          ...(easing === 'bezier'
            ? { bezier: [0.42, 0, 0.58, 1] as [number, number, number, number] }
            : {}),
        },
        { property: 'volume', time: 2, value: 1 },
      ];
      const c = clip({ volume: 0.1, animationOffsetSec: 0.5, keyframes: keys });
      for (const time of [0, 0.25, 0.5, 1, 1.5, 2])
        expect(volumeAt(c, time)).toBeCloseTo(
          Math.max(0, interpolateKeyframes(keys, time + 0.5, 0.1)),
          12,
        );
      const { engine, context } = setup();
      engine.sync([c], tracks, 0, { playing: true, master: 0.4 });
      const gain = context.gains[1]?.gain;
      expect(gain?.calls).toContainEqual({
        type: 'set',
        value: volumeAt(c, 0),
        time: 0,
      });
      if (easing !== 'hold') {
        const curve = gain?.curves[0];
        expect(curve).toBeDefined();
        if (!curve) throw new Error('missing curve');
        expect(curve.values.length).toBe(129);
        expect(curve.values[64]).toBeCloseTo(volumeAt(c, 0.75), 6);
        expect(context.gains[0]?.gain.calls).toContainEqual({
          type: 'set',
          value: 0.4,
          time: 0,
        });
      }
      engine.dispose();
    },
  );
  it('accepts the core transform.volume alias without applying master or duck twice', () => {
    const c = clip({
      volume: 0.8,
      keyframes: [{ property: 'transform.volume', time: 0, value: 0.5 }],
    });
    const { engine, context } = setup();
    engine.sync([c], tracks, 0, { playing: true, master: 0.4 });
    expect(context.gains[1]?.gain.calls).toContainEqual({
      type: 'set',
      value: 0.5,
      time: 0,
    });
    expect(context.gains[0]?.gain.calls).toContainEqual({
      type: 'set',
      value: 0.4,
      time: 0,
    });
    expect(context.gains[2]?.gain.calls).toEqual([]);
    engine.dispose();
  });
});
