import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Container,
  Texture,
  ApplicationOptions,
  TextStyleOptions,
} from 'pixi.js';
import type { ResolvedLayer, SceneGraph } from './types';
import type {
  PreparedRendererResource,
  RendererResourceRequest,
} from './renderer-types';
interface AppHarness {
  stage: Container;
  renderer: { resize: ReturnType<typeof vi.fn> };
  init: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}
const harness = vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  return {
    apps: [] as AppHarness[],
    initFailures: [] as Error[],
    texts: [] as {
      text: string;
      style: TextStyleOptions;
      destroyed: boolean;
    }[],
  };
});
vi.mock('pixi.js', async (original) => {
  const pixi = await original<typeof import('pixi.js')>();
  class FakeText extends pixi.Container {
    text: string;
    style: TextStyleOptions;
    constructor({ text, style }: { text: string; style: TextStyleOptions }) {
      super();
      this.text = text;
      this.style = style;
      const size = typeof style.fontSize === 'number' ? style.fontSize : 40;
      this.boundsArea = new pixi.Rectangle(
        0,
        0,
        Math.min(
          text.length * size * 0.5,
          Number(style.wordWrapWidth ?? Infinity),
        ),
        size * 1.2,
      );
      harness.texts.push(this);
    }
  }
  return {
    ...pixi,
    GlProgram: { from: vi.fn((options: unknown) => options) },
    Text: FakeText,
    CanvasTextMetrics: { measureText: vi.fn(() => ({ width: 12 })) },
    Application: class {
      stage = new pixi.Container();
      renderer = { resize: vi.fn() };
      init = vi.fn(async (options: ApplicationOptions) => {
        void options; /* no GPU creation */
        const failure = harness.initFailures.shift();
        if (failure) throw failure;
      });
      stop = vi.fn();
      render = vi.fn();
      destroy = vi.fn(
        (_options: unknown, children: Parameters<Container['destroy']>[0]) =>
          this.stage.destroy(children),
      );
      constructor() {
        harness.apps.push(this);
      }
    },
  };
});
import { CanvasTextMetrics } from 'pixi.js';
import { PixiRenderer, fitViewport } from './pixi-renderer';
import { resolveText, textStyles } from './text-styles';

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('missing test value');
  return value;
};
const app = () => must(harness.apps.at(-1));
const root = () => app().stage;
const node = (index = 0) => must(root().children[index]);
const content = (index = 0) => must(node(index).children[0]);
function layer(id = 'a', kind: ResolvedLayer['kind'] = 'image'): ResolvedLayer {
  return {
    clipId: id,
    trackId: 'v',
    kind,
    assetId: `asset:${id}`,
    sourceTime: 0,
    localTime: 0,
    animationTime: 0,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    opacity: 1,
    effects: [],
    transitions: [],
    approximations: [],
  };
}
function scene(layers: ResolvedLayer[], frame = 0): SceneGraph {
  return {
    time: frame / 30,
    frame,
    width: 1920,
    height: 1080,
    fps: 30,
    layers,
    audio: [],
    approximations: [],
  };
}
const pixelSource = {
  data: new Uint8Array([255, 128, 0, 255]),
  width: 1,
  height: 1,
};
function lease(key = 'frame', release = vi.fn()): PreparedRendererResource {
  return { key, source: pixelSource, width: 1, height: 1, release };
}
async function renderer(
  getResource: (
    request: RendererResourceRequest,
  ) => PreparedRendererResource | undefined = () => lease(),
  loadFont = async () => true,
) {
  const r = new PixiRenderer({ getResource, loadFont });
  await r.init({
    canvas: document.createElement('canvas'),
    width: 1280,
    height: 720,
  });
  return r;
}
beforeEach(() => {
  harness.apps.length = 0;
  harness.initFailures.length = 0;
  harness.texts.length = 0;
});
describe('host and external-clock lifecycle', () => {
  it('lazy initialization uses supplied canvas, WebGPU/WebGL and no ticker', async () => {
    const r = new PixiRenderer();
    expect(harness.apps).toHaveLength(0);
    const canvas = document.createElement('canvas');
    await r.init({ canvas, width: 640, height: 360 });
    expect(app().init).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas,
        preference: ['webgpu', 'webgl'],
        autoStart: false,
        sharedTicker: false,
      }),
    );
    expect(app().stop).toHaveBeenCalledOnce();
    expect(app().render).not.toHaveBeenCalled();
    expect(root().isRenderGroup).toBe(true);
    const first = app();
    await r.init({ canvas, width: 640, height: 360 });
    expect(app()).toBe(first);
    r.destroy();
    expect(first.destroy).toHaveBeenCalledWith(
      { removeView: false },
      expect.objectContaining({ textureSource: false }),
    );
  });
  it('attempts an explicit WebGL fallback after preferred init fails', async () => {
    harness.initFailures.push(new Error('device rejected'));
    const r = await renderer();
    expect(harness.apps).toHaveLength(2);
    expect(app().init).toHaveBeenCalledWith(
      expect.objectContaining({ preference: ['webgl'] }),
    );
    expect(harness.apps[0]?.destroy).toHaveBeenCalledOnce();
    r.destroy();
  });
  it('surfaces both failures when neither backend initializes', async () => {
    harness.initFailures.push(new Error('gpu'), new Error('gl'));
    await expect(renderer()).rejects.toThrow(
      'WebGPU/WebGL preview initialization failed',
    );
    expect(harness.apps.every((a) => a.destroy.mock.calls.length === 1)).toBe(
      true,
    );
  });
  it('resizes only to caller dimensions and rejects invalid sizes', async () => {
    const r = await renderer();
    r.resize(1080, 1920, 1);
    expect(app().renderer.resize).toHaveBeenCalledWith(1080, 1920, 1);
    expect(() => r.resize(0, 10)).toThrow('invalid viewport');
    r.destroy();
  });
  it('caps landscape and portrait output in both quality modes', () => {
    expect(fitViewport(1920, 1080, 3840, 2160)).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(fitViewport(1920, 1080, 3840, 2160, true)).toEqual({
      width: 1280,
      height: 720,
    });
    expect(fitViewport(1080, 1920, 2160, 3840, true)).toEqual({
      width: 720,
      height: 1280,
    });
    expect(fitViewport(1920, 1080, 640, 640)).toEqual({
      width: 640,
      height: 360,
    });
  });
});
describe('retained diff and resource ownership, mocked submits not pixels', () => {
  it('retains nodes/textures across cloned scenes and reorders without recreation', async () => {
    const r = await renderer();
    await r.render(scene([layer('a'), layer('b')]));
    const a = node(0),
      b = node(1),
      sprite = must(content(0).children[0]);
    const texture = (sprite as unknown as { texture: Texture }).texture;
    await r.render(structuredClone(scene([layer('b'), layer('a')], 1)));
    expect(node(0)).toBe(b);
    expect(node(1)).toBe(a);
    expect(must(content(1).children[0])).toBe(sprite);
    expect((sprite as unknown as { texture: Texture }).texture).toBe(texture);
    expect(app().render).toHaveBeenCalledTimes(2);
    expect(a.isRenderGroup).toBe(false);
    r.destroy();
  });
  it('refcounts shared textures, releases every acquired lease once and destroys only on final reference', async () => {
    const releases: ReturnType<typeof vi.fn>[] = [];
    const r = await renderer(() => {
      const release = vi.fn();
      releases.push(release);
      return lease('shared', release);
    });
    await r.render(scene([layer('a'), layer('b')]));
    const texture = (
      must(content().children[0]) as unknown as { texture: Texture }
    ).texture;
    const destroy = vi.spyOn(texture, 'destroy');
    expect(releases.map((f) => f.mock.calls.length)).toEqual([0, 1]);
    await r.render(scene([layer('b')]));
    expect(destroy).not.toHaveBeenCalled();
    await r.render(scene([]));
    expect(destroy).toHaveBeenCalledOnce();
    expect(releases.every((f) => f.mock.calls.length === 1)).toBe(true);
    r.destroy();
    r.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });
  it('does not reupload immutable sources and uploads an explicitly revised buffer once', async () => {
    let revision = 1;
    const r = await renderer(() => ({ ...lease(), revision }));
    await r.render(scene([layer()]));
    const source = (
      must(content().children[0]) as unknown as { texture: Texture }
    ).texture.source;
    const update = vi.spyOn(source, 'update');
    await r.render(scene([layer()], 1));
    expect(update).not.toHaveBeenCalled();
    revision = 2;
    await r.render(scene([layer()], 2));
    expect(update).toHaveBeenCalledOnce();
    r.destroy();
  });
  it('rejects a resource key reused for a different source and retains the good frame', async () => {
    let source = pixelSource;
    const r = await renderer(() => ({ ...lease('stable'), source }));
    await r.render(scene([layer()]));
    const before = node();
    source = { ...pixelSource, data: new Uint8Array([0, 0, 0, 255]) };
    const result = await r.render(scene([layer()], 1));
    expect(result.retained).toBe(true);
    expect(node()).toBe(before);
    expect(
      result.approximations.some((a) => a.reason.includes('key reused')),
    ).toBe(true);
    r.destroy();
  });
  it('does not destroy the prior good frame or change tree while any next resource is awaiting', async () => {
    const release = vi.fn();
    let available = true;
    const r = await renderer(() =>
      available ? lease('good', release) : undefined,
    );
    await r.render(scene([layer('a')]));
    const first = node();
    available = false;
    const result = await r.render(scene([layer('new')], 10));
    expect(result).toMatchObject({ submitted: false, retained: true });
    expect(node()).toBe(first);
    expect(first.destroyed).toBe(false);
    expect(release).not.toHaveBeenCalled();
    expect(app().render).toHaveBeenCalledTimes(1);
    expect(result.approximations[0]?.reason).toContain('pending');
    r.destroy();
    expect(release).toHaveBeenCalledOnce();
  });
  it('replaces only changed kind, disposes filters and media leases', async () => {
    const r = await renderer();
    const a = layer();
    a.effects = [{ id: 'v', kind: 'vignette', params: {}, scope: 'all' }];
    await r.render(scene([a]));
    const first = node();
    const filter = must(content().filters?.[0]);
    const destroy = vi.spyOn(filter, 'destroy');
    const rect = layer('a', 'shape');
    rect.shape = { kind: 'rect', width: 100, height: 50, fill: [1, 1, 1, 1] };
    await r.render(scene([rect]));
    expect(first.destroyed).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    expect(node()).not.toBe(first);
    r.destroy();
  });
  it('borrows video without installing playback callbacks and never clears src or pauses it', async () => {
    const element = document.createElement('video');
    element.src = 'https://example.test/prepared.mp4';
    const pause = vi.spyOn(element, 'pause'),
      load = vi.spyOn(element, 'load');
    const release = vi.fn();
    const r = await renderer(() => ({
      key: 'video',
      source: element,
      width: 1280,
      height: 720,
      release,
    }));
    const a = layer('v', 'video');
    await r.render(scene([a]));
    r.destroy();
    expect(pause).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(element.src).toContain('prepared.mp4');
    expect(release).toHaveBeenCalledOnce();
  });
  it('releases pending leases immediately on shutdown, even if fonts never settle', async () => {
    const release = vi.fn();
    const r = await renderer(
      () => lease('pending', release),
      () => new Promise<boolean>(() => {}),
    );
    const t = layer('text', 'text');
    t.text = resolveText(
      { content: 'pending', style: 'caption' },
      0,
      1920,
      1080,
    );
    void r.render(scene([layer(), t]));
    r.destroy();
    expect(release).toHaveBeenCalledOnce();
  });
  it('holds the entire prior scene when only one of two next-frame resources is missing', async () => {
    const released: ReturnType<typeof vi.fn>[] = [];
    let missing = false;
    const r = await renderer((req) => {
      if (missing && req.clipId === 'b') return undefined;
      const done = vi.fn();
      released.push(done);
      return lease(req.clipId, done);
    });
    await r.render(scene([layer('a'), layer('b')]));
    const old = [...root().children];
    missing = true;
    const changed = layer('a');
    changed.transform.x = 999;
    expect(await r.render(scene([changed, layer('b')], 1))).toMatchObject({
      retained: true,
      submitted: false,
    });
    expect(root().children).toEqual(old);
    expect(node().position.x).toBe(960);
    expect(released.at(-1)).toHaveBeenCalledOnce();
    r.destroy();
  });
  it('releases not-yet-consumed frame leases when a content update throws', async () => {
    const releases = new Map<string, ReturnType<typeof vi.fn>>();
    const r = await renderer((req) => {
      const done = vi.fn();
      releases.set(req.clipId, done);
      return lease(req.clipId, done);
    });
    const text = layer('t', 'text');
    text.text = resolveText(
      {
        content: 'word',
        style: 'caption-pop',
        words: [{ w: 'word', t: 0, d: 1 }],
      },
      0,
      1920,
      1080,
    );
    vi.mocked(CanvasTextMetrics.measureText).mockImplementationOnce(() => {
      throw new Error('metrics failed');
    });
    await expect(
      r.render(scene([layer('first'), text, layer('last')])),
    ).rejects.toThrow('metrics failed');
    expect(releases.get('last')).toHaveBeenCalledOnce();
    expect(releases.get('first')).not.toHaveBeenCalled();
    r.destroy();
    expect(releases.get('first')).toHaveBeenCalledOnce();
    expect(releases.get('last')).toHaveBeenCalledOnce();
  });
  it('cancels deferred font work on controller invalidation without a replacement render', async () => {
    let resolveFont: (value: boolean) => void = () => {};
    const waiting = new Promise<boolean>((resolve) => {
      resolveFont = resolve;
    });
    const release = vi.fn();
    const r = await renderer(
      () => lease('pending', release),
      () => waiting,
    );
    await r.render(scene([]));
    const text = layer('t', 'text');
    text.text = resolveText(
      { content: 'caption', style: 'caption' },
      0,
      1920,
      1080,
    );
    const old = r.render(scene([layer(), text]));
    r.cancelPending();
    expect(release).toHaveBeenCalledOnce();
    resolveFont(true);
    expect(await old).toMatchObject({ submitted: false, retained: true });
    expect(root().children).toHaveLength(0);
    expect(release).toHaveBeenCalledOnce();
    r.destroy();
  });
  it('cancels stale async font preparation and releases its frame lease', async () => {
    let resolveFont: (value: boolean) => void = () => {};
    const waiting = new Promise<boolean>((resolve) => {
      resolveFont = resolve;
    });
    const release = vi.fn();
    const r = await renderer(
      () => lease('old', release),
      () => waiting,
    );
    const text = layer('t', 'text');
    text.text = resolveText(
      { content: 'caption', style: 'caption' },
      0,
      1920,
      1080,
    );
    const old = r.render(scene([layer(), text]));
    await r.render(scene([]));
    resolveFont(true);
    expect(await old).toMatchObject({ submitted: false });
    expect(release).toHaveBeenCalledOnce();
    expect(root().children).toHaveLength(0);
    r.destroy();
  });
});
describe('resolved geometry, effects and content text', () => {
  it('uses resolved transform/opacity and source-space crop, never applies transition or zoom twice', async () => {
    const r = await renderer();
    const a = layer();
    a.transform = { x: 30, y: -10, rotation: 90, scale: 1.25, opacity: 0.9 };
    a.opacity = 0.4;
    a.crop = { l: 0.1, t: 0.2, r: 0.1, b: 0.2 };
    a.effects = [
      { id: 'p', kind: 'zoom_punch', params: { amount: 3 }, scope: 'all' },
    ];
    await r.render(scene([a]));
    expect(node().position.x).toBe(990);
    expect(node().position.y).toBe(530);
    expect(node().rotation).toBeCloseTo(Math.PI / 2);
    expect(node().scale.x).toBe(1.25);
    expect(node().alpha).toBe(0.4);
    expect(content().mask).toBe(node().children[1]);
    a.crop = undefined;
    await r.render(scene([a]));
    expect(content().mask).toBeUndefined();
    r.destroy();
  });
  it('retains filters in declared effect order and configures resolved whip direction', async () => {
    const r = await renderer();
    const a = layer();
    a.effects = [
      { id: 'g', kind: 'colour_grade', params: { exposure: 1 }, scope: 'all' },
      { id: 'v', kind: 'vignette', params: { strength: 0.5 }, scope: 'all' },
    ];
    a.transitions = [
      {
        kind: 'whip',
        phase: 'in',
        progress: 0.5,
        durationSec: 1,
        direction: 'up',
        blurPx: 64,
      },
    ];
    await r.render(scene([a]));
    const filters = [...(content().filters ?? [])];
    await r.render(scene([structuredClone(a)], 1));
    expect(content().filters).toEqual(filters);
    expect(filters).toHaveLength(3);
    expect(
      (filters[2] as unknown as { values: Float32Array[] }).values[1]?.[1],
    ).toBeCloseTo((-64 * 1280) / 1920);
    r.destroy();
  });
  it('scoped effects plus inverted feathered RLE mask use real filter composite and cutout last', async () => {
    const r = await renderer((request) => lease(request.role));
    const a = layer();
    a.mask = {
      assetId: 'mask',
      sourceTime: 0,
      invert: true,
      feather: 2,
      mode: 'cutout',
      metadata: {
        encoding: 'luma_image',
        coordinateSpace: 'source_uv',
        width: 1,
        height: 1,
        channel: 'red',
      },
    };
    a.effects = [
      { id: 'b', kind: 'blur', params: { radius: 8 }, scope: 'outside_mask' },
    ];
    await r.render(scene([a]));
    const filters = content().filters ?? [];
    expect(filters).toHaveLength(2);
    expect(
      (filters[0] as unknown as { values: Float32Array[] }).values[0]?.[1],
    ).toBe(2);
    expect(
      (filters[1] as unknown as { values: Float32Array[] }).values[0]?.[1],
    ).toBe(3);
    r.destroy();
  });
  it('requests actual resolved media/mask sample times and applies a valid 512 atlas after grade', async () => {
    const requests: RendererResourceRequest[] = [];
    const lut = {
      data: new Uint8Array(512 * 512 * 4).fill(255),
      width: 512,
      height: 512,
    };
    const r = await renderer((request) => {
      requests.push(request);
      return request.role === 'lut'
        ? { key: 'lut', source: lut, width: 512, height: 512 }
        : lease(request.role);
    });
    const a = layer();
    a.sourceTime = 5.25;
    a.mask = {
      assetId: 'mask',
      sourceTime: 4.5,
      frameIndex: 135,
      mode: 'selection',
      invert: false,
      feather: 0,
    };
    a.effects = [
      {
        id: 'grade',
        kind: 'colour_grade',
        params: { exposure: 1, lutAssetId: 'cube' },
        scope: 'inside_mask',
      },
    ];
    await r.render(scene([a]));
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'media', sourceTime: 5.25 }),
        expect.objectContaining({
          role: 'mask',
          sourceTime: 4.5,
          frameIndex: 135,
        }),
        expect.objectContaining({ role: 'lut', assetId: 'cube' }),
      ]),
    );
    expect(content().filters).toHaveLength(2);
    r.destroy();
  });
  it('reports control substitutions from an otherwise implemented effect', async () => {
    const r = await renderer();
    const a = layer();
    a.effects = [
      {
        id: 'g',
        kind: 'grade',
        params: { exposure: 100, mystery: 1 },
        scope: 'all',
      },
    ];
    const result = await r.render(scene([a]));
    expect(
      result.approximations.some((a) => a.reason.includes('clamped')),
    ).toBe(true);
    expect(
      result.approximations.some((a) => a.reason.includes('unrecognized')),
    ).toBe(true);
    r.destroy();
  });
  it('reports unknown and missing features instead of silently marking supported', async () => {
    const r = await renderer(() => undefined);
    const a = layer('a', 'shape');
    a.effects = [{ id: 'x', kind: 'heavy_3d', params: {}, scope: 'all' }];
    const result = await r.render(scene([a]));
    expect(result.approximations.map((x) => x.reason).join(' ')).toContain(
      'unsupported effect heavy_3d',
    );
    expect(result.approximations.map((x) => x.reason).join(' ')).toContain(
      'geometry unavailable',
    );
    r.destroy();
  });
  it.each(Object.keys(textStyles))(
    'loads and lays out style %s from core data',
    async (id) => {
      const load = vi.fn(async () => true);
      const r = await renderer(() => undefined, load);
      const a = layer('t', 'text');
      const style = must(Object.values(textStyles).find((s) => s.id === id));
      a.text = {
        content: 'Hello words',
        secondaryContent: 'Secondary',
        styleId: style.id,
        style,
        safeRect: { x: 96, y: 54, width: 1728, height: 972 },
        anchor: { x: 960, y: 1026 },
        scale: 1,
        words: [],
      };
      await r.render(scene([a]));
      expect(load).toHaveBeenCalled();
      expect(content().children.length).toBeGreaterThan(0);
      expect(harness.texts[0]?.style.fontFamily).toBe(style.fontFamily);
      expect(harness.texts[0]?.style.fontSize).toBe(style.fontSize);
      r.destroy();
    },
  );
  it('updates active yellow word without rebuilding caption objects', async () => {
    const r = await renderer(() => undefined);
    const a = layer('t', 'text');
    a.text = resolveText(
      {
        content: 'one two',
        style: 'caption-pop',
        words: [
          { w: 'one', t: 0, d: 1 },
          { w: 'two', t: 1, d: 1 },
        ],
      },
      0,
      1920,
      1080,
    );
    await r.render(scene([a]));
    const words = [...harness.texts];
    expect(words[0]?.style.fill).toBe(
      textStyles['caption-pop'].activeWordColor,
    );
    a.text = resolveText(
      {
        content: 'one two',
        style: 'caption-pop',
        words: [
          { w: 'one', t: 0, d: 1 },
          { w: 'two', t: 1, d: 1 },
        ],
      },
      1,
      1920,
      1080,
    );
    await r.render(scene([a], 30));
    expect(harness.texts).toEqual(words);
    expect(words[1]?.style.fill).toBe(
      textStyles['caption-pop'].activeWordColor,
    );
    expect(words[0]?.style.fill).toBe(textStyles['caption-pop'].fill);
    r.destroy();
  });
  it('labels failed font load and still submits a defined approximation', async () => {
    const r = await renderer(
      () => undefined,
      async () => false,
    );
    const a = layer('t', 'text');
    a.text = resolveText({ content: 'text', style: 'quote' }, 0, 1920, 1080);
    const result = await r.render(scene([a]));
    expect(result.submitted).toBe(true);
    expect(
      result.approximations.some((x) => x.reason.includes('font unavailable')),
    ).toBe(true);
    r.destroy();
  });
});

/** Twelve deterministic resolved inputs, NOT screenshots or asserted GPU pixels. */
export function twelveFrameInputs(): SceneGraph[] {
  const base = () => layer('fixture');
  const cases: ResolvedLayer[][] = [];
  cases.push([], [base()]);
  const transform = base();
  transform.sourceTime = 3.5;
  transform.transform.x = 90;
  transform.crop = { l: 0.1, t: 0, r: 0, b: 0 };
  cases.push([transform]);
  const animated = base();
  animated.transform.scale = 1.3;
  cases.push([animated]);
  const dissolve = base();
  dissolve.opacity = 0.5;
  cases.push([dissolve]);
  const whip = base();
  whip.transitions = [
    {
      kind: 'whip',
      phase: 'in',
      progress: 0.5,
      durationSec: 0.4,
      direction: 'right',
      blurPx: 64,
    },
  ];
  cases.push([whip]);
  const grade = base();
  grade.effects = [
    {
      id: 'g',
      kind: 'colour_grade',
      params: {
        exposure: 1,
        contrast: 1.08,
        saturation: 0.8,
        lutAssetId: 'lut',
      },
      scope: 'all',
    },
  ];
  cases.push([grade]);
  const effects = base();
  effects.effects = ['blur', 'grain', 'sharpen', 'vignette', 'bw'].map(
    (kind) => ({ id: kind, kind, params: {}, scope: 'all' }),
  );
  cases.push([effects]);
  const masked = base();
  masked.mask = {
    assetId: 'mask',
    invert: true,
    feather: 1,
    mode: 'cutout',
    sourceTime: 0,
  };
  cases.push([masked]);
  const caption = layer('caption', 'text');
  caption.text = resolveText(
    {
      content: 'hello world',
      style: 'caption-pop',
      words: [{ w: 'hello', t: 0, d: 1 }],
    },
    0,
    1920,
    1080,
  );
  cases.push([caption]);
  const lower = layer('lower', 'text');
  lower.text = resolveText(
    { content: 'name', secondaryContent: 'role', style: 'lower-third' },
    0,
    1920,
    1080,
  );
  const bar = layer('line', 'shape');
  bar.shape = {
    kind: 'line',
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 0,
    stroke: [1, 1, 1, 1],
    strokeWidth: 2,
  };
  cases.push([lower, bar]);
  cases.push([base()]);
  return cases.map((layers, i) => ({
    ...scene(layers, i * 3),
    ...(i === 11 ? { width: 1080, height: 1920 } : {}),
  }));
}
it('submits twelve repeatable prepared-frame inputs, no screenshot/performance claim', async () => {
  expect(twelveFrameInputs()).toEqual(twelveFrameInputs());
  expect(twelveFrameInputs()).toHaveLength(12);
  const lut = {
    data: new Uint8Array(512 * 512 * 4).fill(255),
    width: 512,
    height: 512,
  };
  const r = await renderer((request) =>
    request.role === 'lut'
      ? { key: 'lut', source: lut, width: 512, height: 512 }
      : lease(request.role),
  );
  for (const input of twelveFrameInputs())
    expect((await r.render(input)).submitted).toBe(true);
  expect(app().render).toHaveBeenCalledTimes(12);
  r.destroy();
});

describe('paired transition isolation without GPU pixel assertions', () => {
  function paired(
    kind: 'crossfade' | 'dip' | 'slide' = 'crossfade',
  ): SceneGraph {
    const a = layer('out'),
      b = layer('in');
    a.opacity = 0.8;
    b.opacity = 0.6;
    a.transitionPairId = 'pair';
    a.transitionRole = 'outgoing';
    b.transitionPairId = 'pair';
    b.transitionRole = 'incoming';
    return {
      ...scene([layer('under'), a, layer('middle'), b, layer('above')]),
      transitionPairs: [
        {
          id: 'pair',
          trackId: 'v',
          kind,
          outgoingClipId: 'out',
          incomingClipId: 'in',
          compositeAtClipId: 'in',
          boundary: 1,
          start: 0.5,
          end: 1.5,
          progress: 0.5,
          durationSec: 1,
          direction: 'left',
          composite: kind === 'slide' ? 'source_over' : 'premultiplied_mix',
          outgoingWeight: kind === 'dip' ? 0 : 0.5,
          incomingWeight: kind === 'dip' ? 0 : 0.5,
          blackWeight: kind === 'dip' ? 1 : 0,
        },
      ],
    };
  }
  it('isolates each weighted premultiplied member additively and source-overs the pair once at incoming z', async () => {
    const r = await renderer((req) => lease(req.clipId));
    await r.render(paired());
    expect(root().children.map((n) => n.label)).toEqual([
      'under',
      'middle',
      'transition:pair',
      'above',
    ]);
    const group = must(root().children[2]);
    expect(group.isRenderGroup).toBe(false);
    expect(group.filters).toHaveLength(1);
    const a = must(group.children[1]),
      b = must(group.children[2]);
    expect(a.alpha).toBeCloseTo(0.4);
    expect(b.alpha).toBeCloseTo(0.3);
    expect(a.filters?.[0]?.blendMode).toBe('add');
    expect(b.filters?.[0]?.blendMode).toBe('add');
    expect(group.filters?.[0]?.blendMode).toBe('normal');
    const first = group,
      firstA = a;
    await r.render(paired());
    expect(root().children[2]).toBe(first);
    expect(group.children[1]).toBe(firstA);
    expect(a.alpha).toBeCloseTo(0.4);
    await r.render(scene([layer('out'), layer('in')]));
    expect(root().children.map((n) => n.label)).toEqual(['out', 'in']);
    expect(node()).toBe(firstA);
    expect(node().alpha).toBe(1);
    expect(node().filters).toEqual([]);
    expect(first.destroyed).toBe(true);
    r.destroy();
  });
  it('dip midpoint is opaque black in the isolated composite, not a reveal of underlying layers', async () => {
    const r = await renderer();
    await r.render(paired('dip'));
    const group = must(root().children[2]);
    const black = must(group.children[0]);
    expect(black.visible).toBe(true);
    expect(black.alpha).toBe(1);
    expect(black.blendMode).toBe('add');
    expect(group.children[1]?.alpha).toBe(0);
    expect(group.children[2]?.alpha).toBe(0);
    r.destroy();
  });
  it('slide uses ordinary member source-over in one group, consumes resolved transforms without additive weights', async () => {
    const r = await renderer();
    const input = paired('slide');
    const member = input.layers.find((l) => l.clipId === 'in');
    if (member) member.transform.x = 120;
    await r.render(input);
    const group = must(root().children[2]);
    expect(group.children[1]?.alpha).toBe(0.8);
    expect(group.children[2]?.alpha).toBe(0.6);
    expect(group.children[2]?.position.x).toBe(1080);
    expect(group.children[1]?.filters).toBeUndefined();
    r.destroy();
  });
  it('rejects incomplete pair metadata explicitly and retains ordinary layer draws', async () => {
    const r = await renderer();
    const input = paired();
    input.layers = input.layers.filter((l) => l.clipId !== 'out');
    const result = await r.render(input);
    expect(
      result.approximations.some((a) =>
        a.reason.includes('pair members missing'),
      ),
    ).toBe(true);
    expect(root().children.some((n) => n.label === 'in')).toBe(true);
    r.destroy();
  });
});
