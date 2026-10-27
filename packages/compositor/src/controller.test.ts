import { describe, expect, it, vi } from 'vitest';
import type { KimoProject, ServerEvent } from '@kimo/client';
import {
  CompositorController,
  affectedClipIds,
  previewSize,
} from './controller';
import { MediaPool } from './media-pool';
import type { MediaFrame } from './media-types';
import type { SceneRenderer, RenderResult } from './renderer-types';
vi.mock('./audio-engine', async (original) => ({
  ...(await original<typeof import('./audio-engine')>()),
  AudioEngine: class {
    resume = vi.fn(async () => true);
    audioTime = () => null;
    sync = vi.fn();
    pause = vi.fn();
    dispose = vi.fn();
    scrub = vi.fn();
    getLevels = vi.fn(() => ({
      available: false,
      state: 'unavailable',
      peak: 0,
      rms: 0,
      peakDb: null,
      rmsDb: null,
    }));
    loadBuffer = vi.fn(async () => undefined);
  },
}));
const project: KimoProject = {
  id: 'p',
  version: 0,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 10,
  tracks: [
    {
      id: 't',
      name: 'text',
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
      trackId: 't',
      kind: 'text',
      start: 0,
      duration: 10,
      in: 0,
      speed: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      effects: [],
      keyframes: [],
      text: { content: 'hello', style: 'title' },
    },
  },
  markers: [],
};
async function setup(
  options: {
    low?: boolean;
    reduced?: boolean;
    render?: () => Promise<RenderResult>;
  } = {},
) {
  let time = 0;
  let frame: FrameRequestCallback | undefined;
  const renderer: SceneRenderer = {
    init: vi.fn(async () => undefined),
    resize: vi.fn(),
    render: vi.fn(
      options.render ??
        (async () => ({
          submitted: true,
          retained: false,
          approximations: [],
        })),
    ),
    destroy: vi.fn(),
  };
  const pool = new MediaPool();
  vi.spyOn(pool, 'sync').mockResolvedValue({ frames: new Map(), issues: [] });
  vi.spyOn(pool, 'dispose');
  const playback = vi.fn(),
    editAt = vi.fn(),
    overlay = vi.fn(),
    cancel = vi.fn();
  const onScene = vi.fn();
  const controller = new CompositorController({
    project,
    onScene,
    renderer,
    pool,
    now: () => time,
    requestFrame: (cb) => {
      frame = cb;
      return 1;
    },
    cancelFrame: cancel,
    hardwareConcurrency: options.low ? 4 : 8,
    reducedMotion: options.reduced,
    onPlayback: playback,
    onEditAt: editAt,
    onOverlay: overlay,
  });
  await controller.init(document.createElement('canvas'));
  const step = async (next: number) => {
    time = next;
    const callback = frame;
    frame = undefined;
    callback?.(time);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    controller,
    renderer,
    pool,
    onScene,
    playback,
    editAt,
    overlay,
    cancel,
    step,
    hasFrame: () => !!frame,
  };
}
const action = (id = 'action', time = 8): ServerEvent => ({
  t: 'agent.action.start',
  id,
  tool: 'trim',
  title: 'trim',
  args: {},
  target: { clipId: 'a', time },
});
const transport = {
  playing: false,
  speed: 1,
  volume: 1,
  loop: false,
  inPoint: null,
  outPoint: null,
  scrubbing: false,
  scrubAudioEnabled: true,
  followKimo: true,
  shuttle: 0,
};
describe('CompositorController lifecycle and synchronization', () => {
  it('caps landscape and portrait dimensions, low hardware starts at 720', async () => {
    expect(previewSize(project, 4000, 3000, false)).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(
      previewSize({ width: 1080, height: 1920 }, 4000, 4000, true),
    ).toEqual({ width: 720, height: 1280 });
    const s = await setup({ low: true });
    expect(s.controller.debug.quality).toBe('720');
    s.controller.dispose();
  });
  it('uses semantic affected IDs rather than cloned object identity and includes deletion/rollback', () => {
    const clone = structuredClone(project);
    expect([...affectedClipIds(project, clone)]).toEqual([]);
    const changed = clone.clips.a;
    if (!changed) throw new Error('missing fixture');
    changed.start = 2;
    expect([...affectedClipIds(project, clone)]).toEqual(['a']);
    expect([...affectedClipIds(clone, project)]).toEqual(['a']);
    delete clone.clips.a;
    expect([...affectedClipIds(project, clone)]).toEqual(['a']);
    expect([...affectedClipIds(null, project)]).toEqual(['a']);
  });
  it('coalesces invalidations into one RAF and stops when paused/clean', async () => {
    const s = await setup();
    s.controller.updateProject(project);
    s.controller.updateProject(project);
    await s.step(16);
    expect(s.renderer.render).toHaveBeenCalledTimes(1);
    await s.step(32);
    // Flush the trailing <=10Hz telemetry publication, then the sole RAF stops.
    await s.step(132);
    expect(s.hasFrame()).toBe(false);
    s.controller.dispose();
  });
  it('cancels follow on manual seek, respects playing/scrubbing, and correlates action.end', async () => {
    const s = await setup();
    s.controller.event(action());
    await s.step(120);
    expect(s.controller.currentTime).toBeCloseTo(7);
    s.controller.seek(2);
    await s.step(240);
    expect(s.controller.currentTime).toBe(2);
    s.controller.setTransport({ ...transport, scrubbing: true });
    s.controller.event(action());
    await s.step(360);
    expect(s.controller.currentTime).toBe(2);
    s.controller.setTransport({ ...transport, playing: true });
    s.controller.event(action('playing', 9));
    expect(s.editAt).toHaveBeenLastCalledWith({ actionId: 'playing', time: 9 });
    s.controller.event({
      t: 'agent.action.end',
      id: 'other',
      ok: true,
      durationMs: 1,
    });
    expect(s.overlay).toHaveBeenLastCalledWith(
      expect.objectContaining({ actionId: 'playing', ended: false }),
    );
    s.controller.event({
      t: 'agent.action.end',
      id: 'playing',
      ok: true,
      durationMs: 1,
    });
    expect(s.overlay).toHaveBeenLastCalledWith(
      expect.objectContaining({ ended: true }),
    );
    s.controller.dispose();
  });
  it('uses immediate seek for reduced motion and does not invent targets or SAM identity', async () => {
    const s = await setup({ reduced: true });
    s.controller.event(action());
    expect(s.controller.currentTime).toBe(8);
    s.controller.event({
      t: 'sam.mask',
      clipId: 'a',
      maskAssetId: 'm',
      previewPolygon: [],
    });
    expect(s.overlay).toHaveBeenCalledTimes(1);
    s.controller.dispose();
  });
  it('rejects a stale preparation before rendering a newer project and disposes once', async () => {
    const s = await setup();
    let finish:
      | ((value: { frames: Map<string, MediaFrame>; issues: string[] }) => void)
      | undefined;
    vi.mocked(s.pool.sync).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await s.step(16);
    s.controller.seek(5);
    finish?.({ frames: new Map<string, MediaFrame>(), issues: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(s.renderer.render).not.toHaveBeenCalled();
    await s.step(32);
    expect(s.renderer.render).toHaveBeenCalledTimes(1);
    s.controller.dispose();
    s.controller.dispose();
    expect(s.renderer.destroy).toHaveBeenCalledTimes(1);
    expect(s.pool.dispose).toHaveBeenCalledTimes(1);
  });
  it('reports submitted timings, never labels submission as GPU presentation', async () => {
    const s = await setup();
    s.controller.markIngress();
    await s.step(20);
    expect(s.controller.debug.ingressToSubmitMs).toBe(20);
    expect(s.controller.debug.presentedFps).toBeNull();
    s.controller.dispose();
  });
  it('degrades reverse shuttle explicitly instead of playing forwards', async () => {
    const s = await setup();
    s.controller.setTransport({ ...transport, playing: true, shuttle: -1 });
    await s.step(100);
    expect(s.controller.currentTime).toBe(0);
    expect(s.controller.debug.issues.join(' ')).toContain(
      'reverse shuttle unavailable',
    );
    s.controller.dispose();
  });
});

describe('Controller finalized media contract and honest edge cases', () => {
  it('passes fast during drag and exact seek intent on release without a second seek pass', async () => {
    const s = await setup();
    s.controller.setTransport({ ...transport, scrubbing: true }, 1);
    await s.step(20);
    expect(s.pool.sync).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ fast: true, time: 1 }),
    );
    s.controller.setTransport(transport, 1.1);
    await s.step(40);
    expect(s.pool.sync).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ fast: false, time: 1.1 }),
    );
    s.controller.dispose();
  });
  it('downgrades only after a sustained two-second measured low submission window', async () => {
    const s = await setup();
    s.controller.setTransport({ ...transport, playing: true });
    await s.step(501);
    await s.step(1001);
    await s.step(1501);
    await s.step(2001);
    expect(s.controller.debug.quality).toBe('1080');
    await s.step(2501);
    expect(s.controller.debug.quality).toBe('720');
    s.controller.dispose();
  });
  it('pins image leases until all acquired renderer references are released, exactly once', async () => {
    const s = await setup();
    const release = vi.fn();
    const bitmap: ImageBitmap = { width: 10, height: 10, close: vi.fn() };
    vi.spyOn(s.pool, 'acquireImage').mockResolvedValue({ bitmap, release });
    s.controller.setAssets([
      {
        id: 'image',
        name: 'image',
        kind: 'image',
        url: '/image',
        source: 'user',
      },
    ]);
    await Promise.resolve();
    const request = {
      clipId: 'a',
      assetId: 'image',
      sourceTime: 0,
      role: 'media' as const,
    };
    const first = s.controller.getResource(request),
      second = s.controller.getResource(request);
    expect(first?.source).toBe(bitmap);
    s.controller.setAssets([]);
    expect(release).not.toHaveBeenCalled();
    first?.release?.();
    first?.release?.();
    expect(release).not.toHaveBeenCalled();
    second?.release?.();
    expect(release).toHaveBeenCalledTimes(1);
    s.controller.dispose();
  });
  it('buffers a SAM event only by its actual action ID, including arrival before action.start', async () => {
    const s = await setup();
    s.controller.event({
      t: 'sam.mask',
      actionId: 'later',
      clipId: 'a',
      maskAssetId: 'mask',
      previewPolygon: [],
      subjectLabel: 'subject',
    });
    s.controller.event(action('later'));
    expect(s.overlay).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actionId: 'later',
        mask: expect.objectContaining({ subjectLabel: 'subject' }),
      }),
    );
    s.controller.dispose();
  });
  it('records missing renderer invalidation as a real gap rather than claiming stale async pixels were prevented', async () => {
    let finish: ((result: RenderResult) => void) | undefined;
    const s = await setup({
      render: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await s.step(16);
    s.controller.seek(4);
    finish?.({ submitted: true, retained: false, approximations: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(s.controller.debug.submittedRevision).toBe(-1);
    expect(s.controller.debug.issues.join(' ')).toContain(
      'stale async submission cannot be excluded',
    );
    s.controller.dispose();
  });
});

describe('Coherent transition/resource preparation', () => {
  it('prepares outgoing postroll from resolved scene sourceTime even after its nominal clip interval', async () => {
    const { fixtureProject } =
      await import('../../../apps/web/src/app/dev/compositor/fixture');
    const fixture = fixtureProject('crossfade-dip');
    const s = await setup();
    s.controller.setAssets(
      fixture.assets.filter((asset) => asset.kind === 'video'),
    );
    s.controller.updateProject(fixture.project);
    s.controller.seek(2.1);
    await s.step(16);
    expect(s.pool.sync).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ clipId: 'clip-0-0', in: 2.1, start: 2.1 }),
      ]),
      expect.any(Object),
    );
    s.controller.dispose();
  });
  it('does not follow a replayed action ID twice', async () => {
    const s = await setup();
    s.controller.event(action());
    await s.step(240);
    expect(s.controller.currentTime).toBe(8);
    s.controller.seek(1);
    s.controller.event(action());
    await s.step(480);
    expect(s.controller.currentTime).toBe(1);
    s.controller.dispose();
  });
});

describe('Controller typed RLE resource boundary', () => {
  it('loads and validates actual timestamped RLE frame pixels without fabricating a missing frame', async () => {
    const oldFetch = globalThis.fetch;
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null);
    const s = await setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              frames: [
                { frameIndex: 0, width: 2, height: 1, counts: [0, 1, 1] },
              ],
            }),
          ),
      ),
    );
    try {
      s.controller.setAssets([
        {
          id: 'mask',
          name: 'rle',
          kind: 'doc',
          url: '/mask',
          source: 'user',
          mask: {
            encoding: 'rle',
            width: 2,
            height: 1,
            fps: 30,
            timeOrigin: 0,
            coordinateSpace: 'source_uv',
            channel: 'luma',
            payloadUrl: '/mask.rle.json',
            version: 1,
          },
        },
      ]);
      const request = {
        clipId: 'a',
        assetId: 'mask',
        sourceTime: 0,
        role: 'mask' as const,
        frameIndex: 0,
      };
      await vi.waitFor(() =>
        expect(s.controller.getResource(request)).toEqual(
          expect.objectContaining({ width: 2, height: 1 }),
        ),
      );
      const source = s.controller.getResource(request)?.source;
      if (!source || !('data' in source))
        throw new Error('expected pixel resource');
      expect([...source.data]).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
      expect(
        s.controller.getResource({ ...request, frameIndex: 1 }),
      ).toBeUndefined();
    } finally {
      s.controller.dispose();
      vi.stubGlobal('fetch', oldFetch);
      context.mockRestore();
    }
  });
});

describe('Warm-up handoff budget', () => {
  it('adopts at most six physical videos and prevents a second uncounted prefetch cache', async () => {
    const {
      videoCache,
      prefetchVideos,
      clearVideoCache,
      retainCompositorMediaOwnership,
    } = await import('./index');
    const load = vi
      .spyOn(globalThis.HTMLMediaElement.prototype, 'load')
      .mockImplementation(() => undefined);
    const pause = vi
      .spyOn(globalThis.HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined);
    const pool = new MediaPool();
    let release: (() => void) | undefined;
    try {
      clearVideoCache();
      prefetchVideos(
        Array.from({ length: 8 }, (_, i) => ({
          id: `warm-${i}`,
          url: `/warm-${i}`,
        })),
      );
      expect(videoCache.size).toBe(6);
      release = retainCompositorMediaOwnership();
      pool.adoptWarmup(videoCache);
      expect(videoCache.size).toBe(0);
      expect(pool.physicalElementCount).toBe(6);
      prefetchVideos([{ id: 'extra', url: '/extra' }]);
      expect(videoCache.size).toBe(0);
      expect(pool.physicalElementCount).toBe(6);
    } finally {
      pool.dispose();
      release?.();
      clearVideoCache();
      load.mockRestore();
      pause.mockRestore();
    }
  });
});

describe('Final renderer cancellation contract', () => {
  it('cancels in-flight async rendering on a newer seek without remounting or clearing the renderer', async () => {
    let finish: ((result: RenderResult) => void) | undefined;
    const s = await setup({
      render: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const cancel = vi.fn(() =>
      finish?.({ submitted: false, retained: true, approximations: [] }),
    );
    s.renderer.cancelPending = cancel;
    await s.step(16);
    s.controller.seek(4);
    await Promise.resolve();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(s.controller.debug.submittedRevision).toBe(-1);
    expect(s.renderer.destroy).not.toHaveBeenCalled();
    await s.step(32);
    finish?.({ submitted: true, retained: false, approximations: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(s.controller.debug.submittedRevision).toBe(
      s.controller.debug.revision,
    );
    expect(s.renderer.init).toHaveBeenCalledTimes(1);
    s.controller.dispose();
  });
});

describe('Resolved media source timing', () => {
  it('subtracts mask origin once and preserves independent source speed', async () => {
    const s = await setup();
    const original = project.clips.a;
    if (!original) throw new Error('missing test clip');
    s.controller.setAssets([
      {
        id: 'video',
        kind: 'video',
        name: 'video',
        url: '/video',
        durationSec: 30,
        source: 'user',
      },
      {
        id: 'mask',
        kind: 'video',
        name: 'mask',
        url: '/mask',
        durationSec: 30,
        source: 'user',
        mask: {
          encoding: 'video',
          width: 640,
          height: 360,
          fps: 30,
          timeOrigin: 0.5,
          coordinateSpace: 'source_uv',
          channel: 'luma',
        },
      },
    ]);
    s.controller.updateProject({
      ...project,
      clips: {
        a: {
          ...original,
          kind: 'video',
          assetId: 'video',
          in: 1,
          speed: 2,
          text: undefined,
          mask: {
            kind: 'sam',
            mode: 'selection',
            maskAssetId: 'mask',
            invert: false,
            feather: 0,
          },
        },
      },
    });
    s.controller.seek(1);
    await s.step(0);
    expect(s.pool.sync).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          clipId: 'a',
          sourceTiming: { timelineTime: 1, mediaTime: 3, rate: 2 },
        }),
        expect.objectContaining({
          clipId: 'a:mask',
          sourceTiming: { timelineTime: 1, mediaTime: 2.5, rate: 2 },
        }),
      ]),
      expect.anything(),
    );
    s.controller.dispose();
  });
});

describe('Phase 7 transient preview hooks', () => {
  it('hides only visual text and restores on cancel/commit without changing project or scene metadata', async () => {
    const s = await setup();
    await s.step(0);
    const baseline = structuredClone(project);
    s.controller.setEditingTextClip('a');
    await s.step(16);
    const hidden = vi.mocked(s.renderer.render).mock.calls.at(-1)?.[0];
    expect(hidden?.layers).toEqual([]);
    expect(
      s.onScene.mock.calls
        .at(-1)?.[0]
        .layers.map((l: import('./types').ResolvedLayer) => l.clipId),
    ).toEqual(['a']);
    expect(project).toEqual(baseline);
    s.controller.setEditingTextClip(null);
    await s.step(32);
    expect(
      vi
        .mocked(s.renderer.render)
        .mock.calls.at(-1)?.[0]
        .layers.map((l) => l.clipId),
    ).toEqual(['a']);
    s.controller.setEditingTextClip('a');
    s.controller.updateProject({
      ...project,
      clips: {
        a: {
          ...requiredClip(),
          text: { style: 'title', content: 'committed' },
        },
      },
    });
    s.controller.setEditingTextClip(null);
    await s.step(48);
    expect(
      vi.mocked(s.renderer.render).mock.calls.at(-1)?.[0].layers[0]?.text
        ?.content,
    ).toBe('committed');
    s.controller.dispose();
  });
  it('exposes unavailable compare and buffered pitch honestly, and video native capability', async () => {
    const s = await setup();
    expect(s.controller.getAudioLevel()).toMatchObject({
      available: false,
      state: 'unavailable',
      peak: 0,
    });
    expect(s.controller.getCompareCapability()).toMatchObject({
      available: false,
      reason: expect.stringContaining('not implemented'),
    });
    expect(s.controller.getAudioCapabilities('missing')).toMatchObject({
      keepPitch: false,
      reason: expect.any(String),
    });
    s.controller.updateProject({
      ...project,
      clips: { a: { ...requiredClip(), kind: 'video' } },
    });
    expect(s.controller.getAudioCapabilities('a')).toEqual({ keepPitch: true });
    s.controller.dispose();
  });
});

function requiredClip() {
  const clip = project.clips.a;
  if (!clip) throw new Error('Missing fixture clip');
  return clip;
}

it('excludes edited text pixels but retains transparent pair metadata and the complete published scene', async () => {
  const s = await setup();
  const a = requiredClip();
  s.controller.updateProject({
    ...project,
    clips: {
      a: {
        ...a,
        duration: 5,
        transitionOut: { kind: 'crossfade', durationFrames: 30 },
      },
      b: {
        ...a,
        id: 'b',
        start: 5,
        duration: 5,
        transitionIn: { kind: 'crossfade', durationFrames: 30 },
      },
    },
  });
  s.controller.seek(5);
  s.controller.setEditingTextClip('a');
  await s.step(0);
  const rendered = vi.mocked(s.renderer.render).mock.calls.at(-1)?.[0];
  expect(rendered?.layers.map((l) => l.clipId)).toEqual(['b']);
  expect(rendered?.transitionPairs).toHaveLength(1);
  expect(rendered?.excludedTextPairs?.[0]).toMatchObject({
    index: 0,
    layer: { clipId: 'a', opacity: 0 },
  });
  expect(rendered?.excludedTextPairs?.[0]?.layer.text).toBeUndefined();
  expect(s.onScene.mock.calls.at(-1)?.[0].layers).toHaveLength(2);
  s.controller.dispose();
});

it('exposes currentScene as the last submitted unfiltered metadata while text is hidden', async () => {
  const s = await setup();
  expect(s.controller.currentScene).toBeNull();
  await s.step(0);
  expect(s.controller.currentScene?.layers[0]?.text?.content).toBe('hello');
  s.controller.setEditingTextClip('a');
  await s.step(16);
  expect(s.controller.currentScene?.layers[0]?.clipId).toBe('a');
  expect(
    vi.mocked(s.renderer.render).mock.calls.at(-1)?.[0].layers,
  ).toHaveLength(0);
  s.controller.setEditingTextClip(null);
  await s.step(32);
  expect(s.controller.currentScene?.layers[0]?.text?.content).toBe('hello');
  s.controller.dispose();
});

describe('review poster transaction (mock renderer, not GPU acceptance)', () => {
  const frame = () => ({
    submitted: true,
    retained: false,
    approximations: [{ clipId: 'a', reason: 'preview approximation' }],
    frame: {
      blob: new Blob(['pixels'], { type: 'image/png' }),
      width: 1280,
      height: 720,
    },
  });
  it('requests prepared submission at one second, returns actual revision/dimensions and restores owned transport', async () => {
    const s = await setup({ render: async () => frame() });
    s.controller.updateProject({ ...project, version: 7 });
    s.controller.setTransport({ ...transport, playing: true }, 4);
    const before = s.playback.mock.calls.length;
    const pending = s.controller.getFrame(1);
    await s.step(0);
    const result = await pending;
    expect(result).toMatchObject({
      time: 1,
      projectVersion: 7,
      width: 1280,
      height: 720,
      approximations: ['preview approximation'],
    });
    expect(s.renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({ time: 1 }),
      { capture: true, signal: undefined },
    );
    expect(s.controller.currentTime).toBe(4);
    expect(s.playback.mock.calls.slice(before)).not.toContainEqual([
      1,
      false,
      expect.anything(),
    ]);
    s.controller.dispose();
  });
  it('clamps short projects to the last playable sample', async () => {
    const s = await setup({ render: async () => frame() });
    s.controller.updateProject({ ...project, duration: 0.5 });
    const pending = s.controller.getFrame(1);
    await s.step(0);
    expect((await pending).time).toBeCloseTo(0.5 - 1 / 30);
    s.controller.dispose();
  });
  it.each([
    { submitted: false, retained: true, approximations: [] },
    { submitted: true, retained: false, approximations: [] },
  ])(
    'rejects retained or uncaptured frames instead of using source thumbnails',
    async (rendered) => {
      const s = await setup({ render: async () => rendered });
      const pending = expect(s.controller.getFrame(1)).rejects.toThrow(
        'submitted composition',
      );
      await s.step(0);
      await pending;
      s.controller.dispose();
    },
  );
  it('does not restore over a user seek', async () => {
    const s = await setup({ render: async () => frame() });
    const pending = expect(s.controller.getFrame(1)).rejects.toThrow(
      'invalidated',
    );
    s.controller.seek(6);
    await pending;
    expect(s.controller.currentTime).toBe(6);
    s.controller.dispose();
  });
  it('rejects changed project version without restoring the obsolete timeline', async () => {
    const s = await setup();
    const pending = expect(s.controller.getFrame(1)).rejects.toThrow(
      'invalidated',
    );
    s.controller.updateProject({ ...project, version: 1 });
    await pending;
    expect(s.controller.currentTime).toBe(1);
    s.controller.dispose();
  });
  it('aborts and restores still-owned prior time', async () => {
    const s = await setup();
    s.controller.seek(5);
    const abort = new AbortController();
    const pending = expect(
      s.controller.getFrame(1, { signal: abort.signal }),
    ).rejects.toThrow('aborted');
    abort.abort();
    await pending;
    expect(s.controller.currentTime).toBe(5);
    s.controller.dispose();
  });
  it('rejects disposal, uninitialized, already aborted, empty project and active text suppression', async () => {
    const s = await setup();
    s.controller.setEditingTextClip('a');
    await expect(s.controller.getFrame(1)).rejects.toThrow('text editing');
    s.controller.setEditingTextClip(null);
    await expect(
      s.controller.getFrame(1, { signal: AbortSignal.abort() }),
    ).rejects.toThrow('aborted');
    s.controller.updateProject({ ...project, duration: 0 });
    await expect(s.controller.getFrame(1)).rejects.toThrow('playable');
    s.controller.updateProject(project);
    const pending = expect(s.controller.getFrame(1)).rejects.toThrow(
      'disposed',
    );
    s.controller.dispose();
    await pending;
    await expect(s.controller.getFrame(1)).rejects.toThrow('not ready');
  });
  it('propagates readback/taint errors and rejects concurrent capture', async () => {
    const s = await setup({
      render: async () => {
        throw new DOMException('tainted', 'SecurityError');
      },
    });
    const pending = expect(s.controller.getFrame(1)).rejects.toThrow('tainted');
    await expect(s.controller.getFrame(1)).rejects.toThrow('already active');
    await s.step(0);
    await pending;
    s.controller.dispose();
  });
});

describe('poster late intent guards', () => {
  it('rejects agent follow intent and does not restore over it', async () => {
    const s = await setup();
    s.controller.seek(4);
    const pending = expect(s.controller.getFrame(1)).rejects.toThrow(
      'follow intent',
    );
    s.controller.event(action('new-target', 8));
    await pending;
    await s.step(240);
    expect(s.controller.currentTime).toBe(8);
    s.controller.dispose();
  });
  it('rejects version changes during readback and ignores late bytes', async () => {
    let resolve: ((result: RenderResult) => void) | undefined;
    const s = await setup({
      render: () =>
        new Promise<RenderResult>((done) => {
          resolve = done;
        }),
    });
    const pending = expect(s.controller.getFrame(1)).rejects.toThrow(
      'invalidated',
    );
    await s.step(0);
    expect(resolve).toBeDefined();
    s.controller.updateProject({ ...project, version: 2 });
    resolve?.({
      submitted: true,
      retained: false,
      approximations: [],
      frame: {
        blob: new Blob(['stale'], { type: 'image/png' }),
        width: 1280,
        height: 720,
      },
    });
    await pending;
    s.controller.dispose();
  });
});
