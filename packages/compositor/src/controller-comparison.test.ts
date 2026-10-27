import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Asset, KimoProject, ServerEvent } from '@kimo/client';
import { CompositorController, type TransportState } from './controller';
import { AudioEngine } from './audio-engine';
import { MediaPool } from './media-pool';
import type { ComparisonInput } from './comparison';
import type { MediaFrame, VideoRequest } from './media-types';
import type { RenderResult, SceneRenderer } from './renderer-types';
vi.mock('./audio-engine', async (original) => ({
  ...(await original<typeof import('./audio-engine')>()),
  AudioEngine: class {
    resume = vi.fn(async () => true);
    audioTime = () => null;
    sync = vi.fn();
    pause = vi.fn();
    dispose = vi.fn();
    scrub = vi.fn();
    loadBuffer = vi.fn(async () => undefined);
    getLevels = vi.fn();
  },
}));
const asset: Asset = {
  id: 'v',
  name: 'video',
  kind: 'video',
  url: '/current',
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
      speed: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      effects: [],
      keyframes: [],
    },
  },
};
const transport: TransportState = {
  playing: false,
  speed: 1,
  volume: 0.7,
  loop: false,
  inPoint: null,
  outPoint: null,
  scrubbing: false,
  scrubAudioEnabled: true,
  followKimo: true,
  shuttle: 0,
};
const successful = (): RenderResult => ({
  submitted: true,
  retained: false,
  approximations: [],
});
const history = (): ComparisonInput => ({
  id: 'cut',
  project: {
    ...structuredClone(project),
    version: 0,
    clips: { a: { ...required(project.clips.a), in: 7, speed: 2 } },
  },
  assets: [{ ...asset, url: '/historical' }],
  split: 0.5,
});
const controllers: CompositorController[] = [];
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  vi.restoreAllMocks();
});
async function setup(support = true) {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
    () => undefined,
  );
  let now = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 0;
  const renderer: SceneRenderer = {
    init: vi.fn(async () => undefined),
    resize: vi.fn(),
    render: vi.fn(async () => successful()),
    cancelPending: vi.fn(),
    destroy: vi.fn(),
    ...(support ? { renderComparison: vi.fn(async () => successful()) } : {}),
  };
  const pool = new MediaPool();
  const elements = new Map<string, HTMLVideoElement>();
  const sync = vi.spyOn(pool, 'sync').mockImplementation(async (requests) => {
    const frames = new Map<string, MediaFrame>();
    for (const request of requests) {
      let element = elements.get(request.clipId);
      if (!element) {
        element = document.createElement('video');
        element.muted = true;
        Object.defineProperties(element, {
          videoWidth: { value: 1920 },
          videoHeight: { value: 1080 },
        });
        elements.set(request.clipId, element);
      }
      frames.set(request.clipId, {
        element,
        sourceTime: request.sourceTiming?.mediaTime ?? request.in,
        exact: true,
      });
    }
    return { frames, issues: [] };
  });
  const audio = new AudioEngine();
  const request = vi.fn((callback: FrameRequestCallback) => {
    callbacks.set(++next, callback);
    return next;
  });
  const controller = new CompositorController({
    project: structuredClone(project),
    assets: [asset],
    renderer,
    pool,
    audio,
    now: () => now,
    requestFrame: request,
    cancelFrame: (id) => {
      callbacks.delete(id);
    },
  });
  controllers.push(controller);
  await controller.init(document.createElement('canvas'));
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const step = async (time = now) => {
    now = time;
    const scheduled = [...callbacks.values()];
    callbacks.clear();
    for (const callback of scheduled) callback(now);
    await flush();
  };
  return {
    controller,
    renderer,
    pool,
    audio,
    sync,
    step,
    flush,
    request,
    callbacks,
  };
}
describe('cut comparison controller (mock media/renderer, not GPU acceptance)', () => {
  it('uses one union sync/time/submission and current-only raw audio with same IDs and different timing/URLs', async () => {
    const s = await setup();
    s.controller.setComparison(history());
    s.controller.seek(1);
    await s.step();
    expect(s.sync).toHaveBeenCalledTimes(1);
    const [requests, state] = required(s.sync.mock.calls[0]);
    expect(requests).toHaveLength(2);
    expect(new Set(requests.map((item) => item.clipId)).size).toBe(2);
    expect(requests.map((item) => item.asset.url)).toEqual([
      '/current',
      '/historical',
    ]);
    expect(requests.map((item) => item.sourceTiming)).toEqual([
      { timelineTime: 1, mediaTime: 3, rate: 1 },
      { timelineTime: 1, mediaTime: 9, rate: 2 },
    ]);
    expect(state.time).toBe(1);
    expect(s.renderer.render).not.toHaveBeenCalled();
    expect(s.renderer.renderComparison).toHaveBeenCalledTimes(1);
    const frame = required(
      vi.mocked(required(s.renderer.renderComparison)).mock.calls[0],
    )[0];
    expect(frame.current.time).toBe(frame.historical.time);
    expect(frame.current.layers[0]?.clipId).toBe('a');
    expect(frame.historical.layers[0]?.clipId).toBe('a');
    expect(s.audio.sync).toHaveBeenCalledTimes(1);
    const [clips, tracks, time, audioState, elements] = required(
      vi.mocked(s.audio.sync).mock.calls[0],
    );
    expect(clips).toEqual(Object.values(project.clips));
    expect(tracks).toEqual(project.tracks);
    expect(time).toBe(1);
    expect(audioState.master).toBe(1); // controller transport default; never historical/master multiplied twice
    expect([...required(elements).keys()]).toEqual(['a']);
    const currentResource = s.controller.getResource({
      branch: 'current',
      clipId: 'a',
      assetId: 'v',
      role: 'media',
      sourceTime: 3,
    });
    const pastResource = s.controller.getResource({
      branch: 'historical',
      clipId: 'a',
      assetId: 'v',
      role: 'media',
      sourceTime: 9,
    });
    expect(currentResource?.source).not.toBe(pastResource?.source);
    expect(pastResource?.revision).toBe(9);
    expect(s.controller.getComparisonState()).toMatchObject({
      phase: 'ready',
      requiredDecoders: 2,
    });
  });
  it('clones input, exposes frozen stable snapshots and coalesces split changes on the sole RAF', async () => {
    const s = await setup();
    const input = history();
    const listener = vi.fn();
    const unsubscribe = s.controller.subscribeComparison(listener);
    s.controller.setComparison(input);
    required(input.project.clips.a).in = 100;
    required(input.assets[0]).url = '/changed';
    s.controller.setComparisonSplit(0.1);
    s.controller.setComparisonSplit(1.5);
    expect(s.callbacks.size).toBe(1);
    const state = s.controller.getComparisonState();
    expect(s.controller.getComparisonState()).toBe(state);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.approximations)).toBe(true);
    expect(state.split).toBe(1);
    expect(() => s.controller.setComparisonSplit(NaN)).toThrow(RangeError);
    await s.step();
    expect(required(s.sync.mock.calls[0])[0][1]).toMatchObject({
      in: 7,
      asset: { url: '/historical' },
    });
    expect(
      required(
        vi.mocked(required(s.renderer.renderComparison)).mock.calls[0],
      )[0].split,
    ).toBe(1);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    s.controller.setComparison(null);
    expect(listener).not.toHaveBeenCalled();
    await s.step(100);
    expect(s.renderer.render).toHaveBeenCalledOnce();
    expect(s.controller.getComparisonState().phase).toBe('inactive');
  });
  it('keeps grade comparison unavailable and reports unsupported injected cut renderers honestly', async () => {
    const s = await setup(false);
    expect(s.controller.getCompareCapability().available).toBe(false);
    expect(s.controller.getCutComparisonCapability().available).toBe(false);
    s.controller.setComparison(history());
    await s.step();
    expect(s.controller.getComparisonState()).toMatchObject({
      phase: 'unavailable',
      reason: expect.stringContaining('Renderer'),
    });
    expect(s.sync).not.toHaveBeenCalled();
    expect(s.renderer.render).not.toHaveBeenCalled();
  });
  it('gates >6 total active instances at entry and later live revisions, never syncing a truncated union', async () => {
    const s = await setup();
    const input = history();
    input.project.clips = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => [
        String(index),
        { ...required(project.clips.a), id: String(index) },
      ]),
    );
    s.controller.setComparison(input);
    await s.step();
    expect(s.sync).not.toHaveBeenCalled();
    expect(s.controller.getComparisonState()).toMatchObject({
      phase: 'unavailable',
      requiredDecoders: 7,
    });
    s.controller.setComparison(history());
    await s.step();
    expect(s.sync).toHaveBeenCalledOnce();
    s.controller.updateProject({
      ...project,
      version: 2,
      clips: input.project.clips,
    });
    await s.step();
    expect(s.sync).toHaveBeenCalledOnce();
    expect(s.controller.getComparisonState().requiredDecoders).toBe(7);
  });
  it('accepts exactly six active instances and does not add future preroll during playback', async () => {
    const s = await setup();
    const input = history();
    input.project.clips = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [
        String(index),
        { ...required(project.clips.a), id: String(index) },
      ]),
    );
    s.controller.updateProject({
      ...project,
      clips: {
        ...project.clips,
        future: { ...required(project.clips.a), id: 'future', start: 1 },
      },
    });
    s.controller.setComparison(input);
    s.controller.setTransport({ ...transport, playing: true });
    await s.step();
    expect(required(s.sync.mock.calls[0])[0]).toHaveLength(6);
    expect(s.controller.getComparisonState()).toMatchObject({
      phase: 'ready',
      requiredDecoders: 6,
    });
    expect(required(vi.mocked(s.audio.sync).mock.calls[0])[3].master).toBe(0.7);
  });
  it('blocks poster/edit suppression/follow while still accepting authoritative project and assets updates', async () => {
    const s = await setup();
    s.controller.setComparison(history());
    await expect(s.controller.getFrame(1)).rejects.toThrow(
      'leave cut comparison',
    );
    s.controller.setEditingTextClip('a');
    const action: ServerEvent = {
      t: 'agent.action.start',
      id: 'act',
      tool: 'trim',
      title: 'trim',
      args: {},
      target: { time: 8 },
    };
    s.controller.event(action);
    await s.step(240);
    expect(s.controller.currentTime).toBe(0);
    s.controller.setAssets([{ ...asset, url: '/live-revision' }]);
    s.controller.updateProject({
      ...project,
      version: 2,
      clips: { a: { ...required(project.clips.a), in: 5 } },
    });
    await s.step(300);
    expect(required(s.sync.mock.calls.at(-1))[0][0]).toMatchObject({
      in: 5,
      asset: { url: '/live-revision' },
    });
    expect(s.controller.getComparisonState().phase).toBe('ready');
  });
  it('does not submit an incomplete first frame, retained frame, or failed video resources as ready', async () => {
    const s = await setup();
    s.sync.mockResolvedValueOnce({
      frames: new Map(),
      issues: ['decoder failed'],
    });
    s.controller.setComparison(history());
    await s.step();
    expect(s.renderer.renderComparison).not.toHaveBeenCalled();
    expect(s.controller.getComparisonState()).toMatchObject({
      phase: 'unavailable',
      reason: 'decoder failed',
    });
    vi.mocked(required(s.renderer.renderComparison)).mockResolvedValueOnce({
      submitted: false,
      retained: true,
      approximations: [],
    });
    s.controller.seek(1);
    await s.step();
    expect(s.controller.getComparisonState().phase).toBe('preparing');
    expect(s.controller.currentScene).toBeNull();
    s.controller.seek(2);
    await s.step();
    expect(s.controller.getComparisonState().phase).toBe('ready');
  });
  it('fences pending pool seeks across replacement, exit, re-entry, and disposal', async () => {
    const s = await setup();
    let resolve!: (value: {
      frames: Map<string, MediaFrame>;
      issues: string[];
    }) => void;
    s.sync.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    s.controller.setComparison(history());
    await s.step();
    s.controller.setComparison(null);
    s.controller.setComparison({ ...history(), id: 'new' });
    resolve({ frames: new Map(), issues: [] });
    await s.flush();
    expect(s.renderer.renderComparison).not.toHaveBeenCalled();
    await s.step();
    expect(s.controller.getComparisonState()).toMatchObject({
      id: 'new',
      phase: 'ready',
    });
    s.sync.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    s.controller.seek(2);
    await s.step();
    s.controller.dispose();
    resolve({ frames: new Map(), issues: [] });
    await s.flush();
    expect(s.controller.getComparisonState().phase).toBe('inactive');
    expect(s.renderer.destroy).toHaveBeenCalledOnce();
  });
  it('cancels late renderer/font completion and cannot publish stale readiness after split/seek', async () => {
    const s = await setup();
    let resolve!: (value: RenderResult) => void;
    vi.mocked(required(s.renderer.renderComparison)).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    s.controller.setComparison(history());
    await s.step();
    s.controller.seek(2);
    s.controller.setComparisonSplit(0.2);
    expect(s.renderer.cancelPending).toHaveBeenCalled();
    expect(s.audio.sync).not.toHaveBeenCalled();
    resolve(successful());
    await s.flush();
    expect(s.controller.currentScene).toBeNull();
    expect(s.controller.getComparisonState().phase).toBe('preparing');
    await s.step();
    expect(s.controller.currentScene?.time).toBe(2);
  });
  it('disconnects old audio voices before slot reuse and keeps historical elements muted', async () => {
    const s = await setup();
    s.controller.setComparison(history());
    s.controller.setTransport({ ...transport, playing: true });
    await s.step();
    const routed = required(
      required(vi.mocked(s.audio.sync).mock.calls[0])[4],
    ).get('a') as HTMLVideoElement;
    let disconnected = false;
    vi.mocked(s.audio.pause).mockImplementation(() => {
      disconnected = true;
      routed.muted = true;
    });
    s.sync.mockImplementationOnce(async (requests: readonly VideoRequest[]) => {
      expect(disconnected).toBe(true);
      expect(routed.muted).toBe(true);
      return {
        frames: new Map([
          [
            required(requests[0]).clipId,
            { element: routed, sourceTime: 7, exact: true },
          ],
        ]),
        issues: [],
      };
    });
    s.controller.updateProject({ ...project, clips: {} });
    await s.step(50);
    expect(routed.muted).toBe(true);
    expect(
      required(required(vi.mocked(s.audio.sync).mock.calls.at(-1))[4]).size,
    ).toBe(0);
  });
  it('uses current transport range and shows empty historical timeline past a shorter cut', async () => {
    const s = await setup();
    const input = history();
    input.project.duration = 1;
    required(input.project.clips.a).duration = 1;
    s.controller.setComparison(input);
    s.controller.seek(3);
    await s.step();
    const frame = required(
      vi.mocked(required(s.renderer.renderComparison)).mock.calls[0],
    )[0];
    expect(frame.current.time).toBe(3);
    expect(frame.historical.time).toBe(3);
    expect(frame.historical.layers).toHaveLength(0);
    s.controller.seek(20);
    await s.step();
    expect(s.controller.currentTime).toBe(10);
  });
});

function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('Required test fixture missing');
  return value;
}

describe('comparison branch asset lifetimes and resource readiness', () => {
  it('isolates same asset IDs across image/LUT catalogues and releases historical leases only after renderer references', async () => {
    const s = await setup();
    const releases = new Map<string, ReturnType<typeof vi.fn>>();
    vi.spyOn(s.pool, 'acquireImage').mockImplementation(async (asset) => {
      const release = vi.fn();
      releases.set(asset.url, release);
      return { bitmap: { width: 512, height: 512, close: vi.fn() }, release };
    });
    const image: Asset = { ...asset, kind: 'image' };
    const lut: Asset = { ...image, id: 'lut', url: '/current-lut' };
    const imageProject: KimoProject = {
      ...project,
      clips: {
        a: {
          ...required(project.clips.a),
          kind: 'image',
          effects: [
            {
              id: 'grade',
              kind: 'lut',
              scope: 'all',
              params: { assetId: 'lut' },
            },
          ],
        },
      },
    };
    s.controller.setAssets([image, lut]);
    s.controller.updateProject(imageProject);
    const input: ComparisonInput = {
      id: 'images',
      project: imageProject,
      assets: [
        { ...image, url: '/old-image' },
        { ...lut, url: '/old-lut' },
      ],
      split: 0.5,
    };
    s.controller.setComparison(input);
    await s.flush();
    await s.step();
    expect(s.controller.getComparisonState()).toMatchObject({
      phase: 'ready',
      requiredDecoders: 0,
    });
    const current = s.controller.getResource({
      branch: 'current',
      clipId: 'a',
      assetId: 'v',
      role: 'media',
      sourceTime: 0,
    });
    const historical = s.controller.getResource({
      branch: 'historical',
      clipId: 'a',
      assetId: 'v',
      role: 'media',
      sourceTime: 0,
    });
    const currentLut = s.controller.getResource({
      branch: 'current',
      clipId: 'a',
      assetId: 'lut',
      role: 'lut',
      sourceTime: 0,
    });
    const pastLut = s.controller.getResource({
      branch: 'historical',
      clipId: 'a',
      assetId: 'lut',
      role: 'lut',
      sourceTime: 0,
    });
    expect(current?.source).not.toBe(historical?.source);
    expect(currentLut?.source).not.toBe(pastLut?.source);
    s.controller.setComparison(null);
    expect(required(releases.get('/old-image'))).not.toHaveBeenCalled();
    historical?.release?.();
    historical?.release?.();
    pastLut?.release?.();
    expect(required(releases.get('/old-image'))).toHaveBeenCalledOnce();
    expect(required(releases.get('/old-lut'))).toHaveBeenCalledOnce();
    current?.release?.();
    currentLut?.release?.();
    s.controller.dispose();
    expect(required(releases.get('/current'))).toHaveBeenCalledOnce();
    expect(required(releases.get('/current-lut'))).toHaveBeenCalledOnce();
  });
  it('releases late historical image loads without installing them after exit/re-entry or disposal', async () => {
    const s = await setup();
    let resolve:
      | ((lease: { bitmap: ImageBitmap; release: () => void }) => void)
      | undefined;
    vi.spyOn(s.pool, 'acquireImage').mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const input = history();
    input.assets = [{ ...asset, kind: 'image' }];
    input.project.clips.a = {
      ...required(input.project.clips.a),
      kind: 'image',
    };
    s.controller.setComparison(input);
    s.controller.setComparison(null);
    s.controller.setComparison(history());
    const release = vi.fn();
    required(resolve)({
      bitmap: { width: 2, height: 2, close: vi.fn() },
      release,
    });
    await s.flush();
    expect(release).toHaveBeenCalledOnce();
    await s.step();
    expect(s.controller.getComparisonState().phase).toBe('ready');
    expect(
      s.controller.getResource({
        branch: 'historical',
        clipId: 'a',
        assetId: 'v',
        role: 'media',
        sourceTime: 7,
      })?.key,
    ).toMatch(/^video:/);
  });
  it('keeps the very first comparison unsubmitted while images are pending and reports image errors as unavailable', async () => {
    const s = await setup();
    let reject: ((error: Error) => void) | undefined;
    vi.spyOn(s.pool, 'acquireImage').mockImplementationOnce(
      () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    );
    const input = history();
    input.assets = [{ ...asset, kind: 'image' }];
    input.project.clips.a = {
      ...required(input.project.clips.a),
      kind: 'image',
    };
    s.controller.setComparison(input);
    await s.step();
    expect(s.renderer.renderComparison).not.toHaveBeenCalled();
    expect(s.controller.getComparisonState().phase).toBe('preparing');
    required(reject)(new Error('historical image failed'));
    await s.flush();
    await s.step();
    expect(s.controller.getComparisonState()).toMatchObject({
      phase: 'unavailable',
      reason: expect.stringContaining('historical image failed'),
    });
  });
  it('does not load historical audio buffers and surfaces font failure without ready/first-frame claims', async () => {
    const s = await setup();
    const input = history();
    input.assets = [...input.assets, { ...asset, id: 'sound', kind: 'audio' }];
    vi.mocked(required(s.renderer.renderComparison)).mockResolvedValueOnce({
      submitted: false,
      retained: false,
      approximations: [
        { clipId: 'a', reason: 'canvas font unavailable; system fallback' },
      ],
    });
    s.controller.setComparison(input);
    await s.step();
    expect(s.audio.loadBuffer).not.toHaveBeenCalled();
    expect(s.controller.getComparisonState()).toMatchObject({
      phase: 'unavailable',
      reason: 'canvas font unavailable; system fallback',
    });
    expect(s.controller.currentScene).toBeNull();
  });
  it('requires a cancellable renderer instead of advertising unsafe asynchronous comparison', async () => {
    const s = await setup();
    delete s.renderer.cancelPending;
    expect(s.controller.getCutComparisonCapability().available).toBe(false);
    s.controller.setComparison(history());
    await s.step();
    expect(s.renderer.renderComparison).not.toHaveBeenCalled();
    expect(s.controller.getComparisonState().phase).toBe('unavailable');
  });
});

describe('comparison decoder and branch edge cases', () => {
  it.each([0, 1, 2, 3, 4, 5, 6])(
    'handles exactly %i union decoders without hidden extra requests',
    async (count) => {
      const s = await setup();
      s.controller.updateProject({ ...project, clips: {} });
      const input = history();
      input.project.clips = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          String(index),
          { ...required(project.clips.a), id: String(index) },
        ]),
      );
      s.controller.setComparison(input);
      await s.step();
      expect(s.sync).toHaveBeenCalledOnce();
      expect(required(s.sync.mock.calls[0])[0]).toHaveLength(count);
      expect(s.controller.getComparisonState()).toMatchObject({
        phase: 'ready',
        requiredDecoders: count,
      });
    },
  );
  it('counts video masks separately with original branch clip identities and origin-correct source samples', async () => {
    const s = await setup();
    const input = history();
    const mask: Asset = {
      ...asset,
      id: 'mask',
      url: '/mask',
      mask: {
        encoding: 'video',
        width: 640,
        height: 360,
        fps: 30,
        timeOrigin: 0.5,
        coordinateSpace: 'source_uv',
        channel: 'luma',
      },
    };
    const masked: KimoProject = {
      ...project,
      clips: {
        a: {
          ...required(project.clips.a),
          mask: {
            kind: 'sam',
            mode: 'selection',
            maskAssetId: 'mask',
            invert: false,
            feather: 0,
          },
        },
      },
    };
    input.project = masked;
    input.assets = [asset, { ...mask, url: '/old-mask' }];
    s.controller.updateProject(masked);
    s.controller.setAssets([asset, mask]);
    s.controller.setComparison(input);
    s.controller.seek(1);
    await s.step();
    const requests = required(s.sync.mock.calls[0])[0];
    expect(requests).toHaveLength(4);
    expect(
      requests
        .filter((item) => item.purpose === 'mask')
        .map((item) => item.sourceTiming?.mediaTime),
    ).toEqual([2.5, 2.5]);
    expect(s.controller.getComparisonState().requiredDecoders).toBe(4);
    expect([
      ...required(required(vi.mocked(s.audio.sync).mock.calls[0])[4]).keys(),
    ]).toEqual(['a']);
    expect(
      s.controller.getResource({
        branch: 'current',
        clipId: 'a',
        assetId: 'mask',
        role: 'mask',
        sourceTime: 3,
      })?.source,
    ).not.toBe(
      s.controller.getResource({
        branch: 'historical',
        clipId: 'a',
        assetId: 'mask',
        role: 'mask',
        sourceTime: 3,
      })?.source,
    );
  });
  it('separates same-ID RLE frame caches even with the same payload URL and clears historical access on exit', async () => {
    const s = await setup();
    const originalFetch = globalThis.fetch;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    let calls = 0;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            frames: [
              {
                frameIndex: 60,
                width: 1,
                height: 1,
                counts: ++calls === 1 ? [1] : [0, 1],
              },
            ],
          }),
        ),
    );
    try {
      const mask: Asset = {
        ...asset,
        id: 'mask',
        kind: 'doc',
        mask: {
          encoding: 'rle',
          width: 1,
          height: 1,
          fps: 30,
          coordinateSpace: 'source_uv',
          channel: 'luma',
          payloadUrl: '/same-rle',
          version: 1,
        },
      };
      const masked: KimoProject = {
        ...project,
        clips: {
          a: {
            ...required(project.clips.a),
            mask: {
              kind: 'sam',
              mode: 'cutout',
              maskAssetId: 'mask',
              invert: false,
              feather: 0,
            },
          },
        },
      };
      s.controller.setAssets([asset, mask]);
      s.controller.updateProject(masked);
      s.controller.setComparison({
        id: 'rle',
        project: masked,
        assets: [asset, mask],
        split: 0.5,
      });
      const request = {
        clipId: 'a',
        assetId: 'mask',
        role: 'mask' as const,
        sourceTime: 2,
        frameIndex: 60,
      };
      await vi.waitFor(() =>
        expect(
          s.controller.getResource({ ...request, branch: 'historical' }),
        ).toBeDefined(),
      );
      const live = required(
        s.controller.getResource({ ...request, branch: 'current' }),
      );
      const old = required(
        s.controller.getResource({ ...request, branch: 'historical' }),
      );
      expect(live.key).not.toBe(old.key);
      expect(live.source).not.toEqual(old.source);
      await s.step();
      expect(s.controller.getComparisonState()).toMatchObject({
        phase: 'ready',
        requiredDecoders: 2,
      });
      s.controller.setComparison(null);
      expect(
        s.controller.getResource({ ...request, branch: 'historical' }),
      ).toBeUndefined();
      expect(
        s.controller.getResource({ ...request, branch: 'current' })?.key,
      ).toBe(live.key);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it('reports thrown renderer failure and can recover on a later seek', async () => {
    const s = await setup();
    vi.mocked(required(s.renderer.renderComparison)).mockRejectedValueOnce(
      new Error('font preparation failed'),
    );
    s.controller.setComparison(history());
    await s.step();
    expect(s.controller.getComparisonState()).toMatchObject({
      phase: 'unavailable',
      reason: 'font preparation failed',
    });
    s.controller.seek(1);
    await s.step();
    expect(s.controller.getComparisonState().phase).toBe('ready');
  });
});
