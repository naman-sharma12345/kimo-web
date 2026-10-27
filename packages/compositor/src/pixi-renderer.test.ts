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
  renderer: {
    resize: ReturnType<typeof vi.fn>;
    extract: { canvas: ReturnType<typeof vi.fn> };
    background: { color: unknown; alpha: number };
  };
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
    CanvasTextMetrics: {
      clearMetrics: vi.fn(),
      measureText: vi.fn(
        (_text: string, style: import('pixi.js').TextStyle) => ({
          width: 12,
          lineHeight: style.fontSize + 7.25,
        }),
      ),
    },
    Application: class {
      stage = new pixi.Container();
      renderer = {
        resize: vi.fn(),
        extract: {
          canvas: vi.fn(() => ({
            width: 1280,
            height: 720,
            convertToBlob: async () =>
              new Blob(['readback'], { type: 'image/png' }),
          })),
        },
        background: { color: 0 as unknown, alpha: 1 },
      };
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
    const failure = await renderer().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).message).toBe(
      'WebGPU/WebGL preview initialization failed',
    );
    expect(
      (failure as AggregateError).errors.map((error: Error) => error.message),
    ).toEqual(['gpu', 'gl', expect.stringContaining('GPU support:')]);
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
  it('retries a failed font and rebuilds fallback text only after the requested face actually loads', async () => {
    const load = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const r = await renderer(() => undefined, load);
    const a = layer('t', 'text');
    a.text = resolveText({ content: 'retry', style: 'quote' }, 0, 1920, 1080);
    await r.render(scene([a]));
    const first = harness.texts[0];
    expect(first).toBeDefined();
    const second = await r.render(scene([a], 1));
    expect(
      second.approximations.some((x) => x.reason.includes('font unavailable')),
    ).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
    expect(harness.texts).toHaveLength(2);
    expect(harness.texts[1]).not.toBe(first);
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
  it.each(['crossfade', 'dip'] as const)(
    'keeps %s pair weights/black plane when an edited text visual is excluded',
    async (kind) => {
      const resources = vi.fn((req: RendererResourceRequest) =>
        lease(req.clipId),
      );
      const r = await renderer(resources);
      const input = paired(kind);
      const excluded = input.layers.find((l) => l.clipId === 'out');
      if (!excluded) throw new Error('Missing pair fixture');
      input.layers = input.layers.filter((l) => l.clipId !== 'out');
      input.excludedTextPairs = [
        {
          index: 1,
          layer: { ...excluded, kind: 'text', assetId: undefined, opacity: 0 },
        },
      ];
      const result = await r.render(input);
      expect(
        result.approximations.map((a) => a.reason).join(' '),
      ).not.toContain('members missing');
      expect(resources.mock.calls.some(([req]) => req.clipId === 'out')).toBe(
        false,
      );
      const group = root().children.find((n) => n.label === 'transition:pair');
      if (!group) throw new Error('Missing pair container');
      expect(group.children[0]?.alpha).toBe(kind === 'dip' ? 1 : 0);
      expect(group.children[1]?.alpha).toBe(0);
      expect(group.children[2]?.alpha).toBe(kind === 'dip' ? 0 : 0.3);
      expect(harness.texts).toHaveLength(0);
      r.destroy();
    },
  );
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

describe('failure-only GPU diagnostics (no device/context creation)', () => {
  it('reports absent API and null adapter distinctly without claiming GL context support', async () => {
    const { gpuAvailabilityDiagnostic } = await import('./pixi-renderer');
    expect(
      (
        await gpuAvailabilityDiagnostic({
          secureContext: true,
          webgl2Api: false,
        })
      ).message,
    ).toContain('WebGPU adapter API absent');
    const requestAdapter = vi.fn(async () => null);
    const diagnostic = await gpuAvailabilityDiagnostic({
      secureContext: true,
      webgl2Api: true,
      requestAdapter,
    });
    expect(diagnostic.message).toContain('unavailable (null adapter)');
    expect(diagnostic.message).toContain('context not probed');
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });
  it('bounds a hanging probe and excludes raw probe rejection text', async () => {
    const { gpuAvailabilityDiagnostic } = await import('./pixi-renderer');
    const rejected = await gpuAvailabilityDiagnostic({
      secureContext: false,
      webgl2Api: false,
      requestAdapter: async () => {
        throw new Error('secret');
      },
    });
    expect(rejected.message).toContain('probe rejected');
    expect(rejected.message).not.toContain('secret');
    vi.useFakeTimers();
    try {
      const pending = gpuAvailabilityDiagnostic({
        secureContext: true,
        webgl2Api: true,
        requestAdapter: () => new Promise(() => undefined),
      });
      await vi.advanceTimersByTimeAsync(500);
      expect((await pending).message).toContain('availability unknown');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Phase 7 text layout and project background', () => {
  it.each(['left', 'center', 'right'] as const)(
    'matches measured and rendered %s text with source colour and top glyph bounds',
    async (alignment) => {
      const { measureTextOverlay } = await import('./index');
      const r = await renderer(() => undefined);
      const a = layer('t', 'text');
      a.text = resolveText(
        {
          style: 'caption-pop',
          content: 'one lengthy two',
          position: 'top',
          alignment,
          fontSize: 90,
          color: [1, 0.5, 0, 0.25],
          words: [
            { w: 'one', t: 0, d: 1 },
            { w: 'lengthy', t: 1, d: 1 },
            { w: 'two', t: 2, d: 1 },
          ],
        },
        1,
        1920,
        1080,
      );
      a.text.safeRect.width = 500;
      const graph = scene([a]);
      await r.render(graph);
      const layout = await measureTextOverlay(a, graph);
      const block = must(content().children.at(-1));
      const bounds = block.getLocalBounds();
      expect(layout?.y).toBe(54 - 540);
      expect(block.y + bounds.y).toBe(layout?.y);
      expect(block.x + bounds.x).toBe(layout?.x);
      expect(layout?.words.map((w) => [w.x, w.y, w.width, w.height])).toEqual(
        block.children.map((w) => {
          const b = w.getLocalBounds();
          return [block.x + w.x + b.x, block.y + w.y + b.y, b.width, b.height];
        }),
      );
      expect(harness.texts[0]?.style.align).toBe(alignment);
      expect(harness.texts[0]?.style.fill).toBe('rgba(255, 128, 0, 0.25)');
      expect(harness.texts[1]?.style.fill).toBe('#FFD84D');
      r.destroy();
    },
  );
  it('renders type-on partial content without full old word nodes and reuses same-character frames', async () => {
    const r = await renderer(() => undefined);
    const a = layer('t', 'text');
    const text = {
      style: 'caption-pop' as const,
      content: 'fresh',
      animation: 'type on' as const,
      words: [{ w: 'stale', t: 0, d: 10 }],
    };
    a.text = resolveText(text, 0.1, 1920, 1080);
    await r.render(scene([a]));
    expect(harness.texts.map((t) => t.text)).toEqual(['FRE']);
    const primary = harness.texts[0];
    a.text = resolveText(text, 0.099, 1920, 1080);
    await r.render(scene([a], 1));
    expect(harness.texts).toEqual([primary]);
    r.destroy();
  });
  it('sets the real renderer clear colour/alpha on the existing application', async () => {
    const r = await renderer();
    await r.render({ ...scene([]), background: [1, 0.5, 0, 0.25] });
    expect(app().renderer.background).toEqual({
      color: [1, 0.5, 0],
      alpha: 0.25,
    });
    await r.render(scene([]));
    expect(app().renderer.background).toEqual({ color: [0, 0, 0], alpha: 1 });
    expect(harness.apps).toHaveLength(1);
    r.destroy();
  });
});

describe('Primary/secondary viewer measurement contract', () => {
  function fontSet(value: unknown): () => void {
    const previous = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', { configurable: true, value });
    return () => {
      if (previous) Object.defineProperty(document, 'fonts', previous);
      else Reflect.deleteProperty(document, 'fonts');
    };
  }
  function lowerThird() {
    const a = layer('text', 'text');
    a.text = resolveText(
      {
        style: 'lower-third',
        content: 'Primary',
        secondaryContent: 'Secondary line',
        alignment: 'right',
        color: [0.1, 0.2, 0.3, 0.4],
      },
      0,
      1080,
      1920,
    );
    return a;
  }
  it('exposes separate actual primary/secondary glyph bounds and measured typography without changing combined bounds', async () => {
    const { measureResolvedTextLayout } = await import('./index');
    const a = lowerThird();
    const loadFont = vi.fn(async () => true);
    const measured = await measureResolvedTextLayout(
      a,
      { ...scene([a]), width: 1080, height: 1920 },
      { loadFont },
    );
    expect(measured?.status).toBe('ready');
    expect(measured?.primary.style).toMatchObject({
      fontFamily: 'Geist',
      fontWeight: 500,
      fontSize: 22.5,
      lineHeight: 29.75,
      letterSpacing: 0,
      color: 'rgba(26, 51, 77, 0.4)',
      textAlign: 'right',
    });
    expect(measured?.secondary?.style).toMatchObject({
      fontFamily: 'Geist',
      fontWeight: 400,
      fontSize: 15.75,
      lineHeight: 23,
      letterSpacing: 0,
      color: 'rgba(26, 51, 77, 0.4)',
      textAlign: 'right',
    });
    const primary = measured?.primary.bounds,
      secondary = measured?.secondary?.bounds;
    if (!measured || !primary || !secondary)
      throw new Error('Missing measured regions');
    expect(primary.y).toBe(measured.y);
    expect(secondary.y).toBeCloseTo(primary.y + primary.height, 12);
    expect(measured.width).toBe(Math.max(primary.width, secondary.width));
    expect(measured.height).toBeCloseTo(primary.height + secondary.height, 12);
    expect(loadFont.mock.calls).toHaveLength(2);
    expect(harness.apps).toHaveLength(0); // CPU text layout, no extra renderer/context.
  });
  it('shares primary/secondary node layout with the retained renderer including alignment', async () => {
    const { measureTextOverlay } = await import('./index');
    const r = await renderer(() => undefined);
    const a = lowerThird(),
      graph = { ...scene([a]), width: 1080, height: 1920 };
    await r.render(graph);
    const measured = await measureTextOverlay(a, graph, {
      loadFont: async () => true,
    });
    const block = must(content().children.at(-1));
    const expected = block.children.map((child) => {
      const box = child.getLocalBounds();
      return {
        x: block.x + child.x + box.x,
        y: block.y + child.y + box.y,
        width: box.width,
        height: box.height,
      };
    });
    expect(measured?.primary.bounds).toEqual(expected[0]);
    expect(measured?.secondary?.bounds).toEqual(expected[1]);
    r.destroy();
  });
  it('requires registered loaded faces, not check=true with empty fallback faces', async () => {
    const { measureTextOverlay } = await import('./index');
    const restore = fontSet({
      status: 'loaded',
      load: vi.fn(async () => []),
      check: vi.fn(() => true),
    });
    try {
      const a = lowerThird();
      expect((await measureTextOverlay(a, scene([a])))?.status).toBe(
        'unavailable',
      );
    } finally {
      restore();
    }
  });
  it('returns pending promptly, keeps measured data, and becomes ready only after actual faces load', async () => {
    const { measureTextOverlay } = await import('./index');
    const fonts = {
      status: 'loading',
      load: vi.fn(async () => [{ status: 'loaded' }]),
      check: vi.fn(() => true),
    };
    const restore = fontSet(fonts);
    try {
      const a = lowerThird();
      const pending = await measureTextOverlay(a, scene([a]));
      expect(pending?.status).toBe('font-pending');
      expect(pending?.primary.bounds.width).toBeGreaterThan(0);
      const cleared = vi.mocked(CanvasTextMetrics.clearMetrics).mock.calls
        .length;
      fonts.status = 'loaded';
      expect((await measureTextOverlay(a, scene([a])))?.status).toBe('ready');
      expect(CanvasTextMetrics.clearMetrics).toHaveBeenCalledTimes(cleared + 1);
    } finally {
      restore();
    }
  });
  it('reports unavailable for rejected load, absent FontFaceSet or any missing secondary font', async () => {
    const { measureTextOverlay } = await import('./index');
    const a = lowerThird();
    const restore = fontSet(undefined);
    try {
      expect((await measureTextOverlay(a, scene([a])))?.status).toBe(
        'unavailable',
      );
    } finally {
      restore();
    }
    expect(
      (
        await measureTextOverlay(a, scene([a]), {
          loadFont: async (css) => !css.includes('400'),
        })
      )?.status,
    ).toBe('unavailable');
    expect(
      (
        await measureTextOverlay(a, scene([a]), {
          loadFont: async () => {
            throw new Error('font failed');
          },
        })
      )?.status,
    ).toBe('unavailable');
  });
  it('omits secondary when no secondary glyphs exist, and never substitutes fontSize*1.2 for absent metrics', async () => {
    const { measureTextOverlay } = await import('./index');
    const a = layer('text', 'text');
    a.text = resolveText({ style: 'title', content: 'Single' }, 0, 1920, 1080);
    const measured = await measureTextOverlay(a, scene([a]), {
      loadFont: async () => true,
    });
    expect(measured?.secondary).toBeUndefined();
    expect(measured?.primary.style.lineHeight).toBe(127.25);
    expect(measured?.primary.style.lineHeight).not.toBe(144);
    vi.mocked(CanvasTextMetrics.measureText).mockReturnValueOnce({
      width: 12,
      lineHeight: NaN,
    } as ReturnType<typeof CanvasTextMetrics.measureText>);
    await expect(
      measureTextOverlay(a, scene([a]), { loadFont: async () => true }),
    ).rejects.toThrow('typography metrics unavailable');
    expect(harness.apps).toHaveLength(0);
  });
});

it('retains lower-third secondary glyphs and separate editable bounds in pop-word mode', async () => {
  const { measureTextOverlay } = await import('./index');
  const r = await renderer(() => undefined);
  const a = layer('t', 'text');
  a.text = resolveText(
    {
      style: 'lower-third',
      content: 'one two',
      secondaryContent: 'role',
      animation: 'pop words',
    },
    0,
    1920,
    1080,
  );
  await r.render(scene([a]));
  expect(harness.texts.map((t) => t.text)).toEqual(['one', 'two', 'role']);
  const layout = await measureTextOverlay(a, scene([a]), {
    loadFont: async () => true,
  });
  expect(layout?.secondary?.bounds.height).toBeGreaterThan(0);
  expect(layout?.secondary?.bounds.y).toBeCloseTo(
    (layout?.primary.bounds.y ?? 0) + (layout?.primary.bounds.height ?? 0),
    12,
  );
  r.destroy();
});

it('keeps legacy combined-bound assignments compatible and exposes uppercase plus actual stroke alpha', async () => {
  const { measureTextOverlay } = await import('./index');
  const legacy: import('./index').TextOverlayBounds = {
    x: 0,
    y: 0,
    width: 10,
    height: 20,
    words: [],
  };
  expect(legacy.primary).toBeUndefined();
  expect(legacy.status).toBeUndefined();
  const a = layer('t', 'text');
  a.text = resolveText(
    { style: 'caption-pop', content: 'source case' },
    0,
    1920,
    1080,
  );
  expect(
    (await measureTextOverlay(a, scene([a]), { loadFont: async () => true }))
      ?.primary.style.textTransform,
  ).toBe('uppercase');
  a.text = resolveText(
    { style: 'caption-clean', content: 'source case' },
    0,
    1920,
    1080,
  );
  const style = (
    await measureTextOverlay(a, scene([a]), { loadFont: async () => true })
  )?.primary.style;
  expect(style?.textTransform).toBe('none');
  expect(style?.WebkitTextStroke).toBe('2px rgba(0, 0, 0, 0.25)');
});

describe('poster extraction (source-level mock, not GPU pixel acceptance)', () => {
  it('extracts the submitted prepared tree on the same renderer with explicit frame/background/resolution', async () => {
    const r = await renderer();
    const composition = {
      ...scene([layer()]),
      background: [0.1, 0.2, 0.3, 1] as [number, number, number, number],
    };
    const result = await r.render(composition, { capture: true });
    expect(result).toMatchObject({
      submitted: true,
      retained: false,
      frame: { width: 1280, height: 720 },
    });
    expect(result.frame?.blob.type).toBe('image/png');
    expect(app().render).toHaveBeenCalledOnce();
    expect(app().renderer.extract.canvas).toHaveBeenCalledWith({
      target: root(),
      frame: expect.objectContaining({ x: 0, y: 0, width: 1920, height: 1080 }),
      resolution: 2 / 3,
      clearColor: composition.background,
    });
    expect(app().render.mock.invocationCallOrder[0]).toBeLessThan(
      app().renderer.extract.canvas.mock.invocationCallOrder[0] ?? 0,
    );
    expect(harness.apps).toHaveLength(1);
    r.destroy();
  });
  it('rejects missing initial resources, retained frames, missing font, abort and taint rather than exporting a substitute', async () => {
    const empty = await renderer(() => undefined);
    await expect(
      empty.render(scene([layer()]), { capture: true }),
    ).rejects.toThrow('not ready');
    expect(app().renderer.extract.canvas).not.toHaveBeenCalled();
    empty.destroy();
    const r = await renderer();
    await r.render(scene([layer()]));
    app().renderer.extract.canvas.mockImplementationOnce(() => {
      throw new DOMException('tainted', 'SecurityError');
    });
    await expect(r.render(scene([layer()]), { capture: true })).rejects.toThrow(
      'tainted',
    );
    await expect(
      r.render(scene([layer()]), {
        capture: true,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow('aborted');
    r.destroy();
    const fonts = await renderer(
      () => lease(),
      async () => false,
    );
    const text = layer('title', 'text');
    text.assetId = undefined;
    text.text = resolveText(
      { content: 'actual title', style: 'title-serif' },
      0,
      1920,
      1080,
    );
    await expect(
      fonts.render(scene([text]), { capture: true }),
    ).rejects.toThrow('not ready');
    expect(app().renderer.extract.canvas).not.toHaveBeenCalled();
    fonts.destroy();
  });
  it('rejects disposal or renderer revision races during asynchronous encoding', async () => {
    const r = await renderer();
    let resolve: ((blob: Blob) => void) | undefined;
    app().renderer.extract.canvas.mockReturnValueOnce({
      width: 1280,
      height: 720,
      convertToBlob: () =>
        new Promise<Blob>((done) => {
          resolve = done;
        }),
    });
    const result = expect(
      r.render(scene([layer()]), { capture: true }),
    ).rejects.toThrow('invalidated');
    for (let i = 0; i < 10 && !resolve; i++) await Promise.resolve();
    expect(resolve).toBeDefined();
    r.cancelPending();
    await result; // Cancellation does not wait for the abandoned encoder.
    resolve?.(new Blob(['pixels'], { type: 'image/png' }));
    r.destroy();
  });
});

describe('poster font preparation cancellation', () => {
  it('releases capture promptly without waiting for a pending font or submitting a fallback', async () => {
    let loaded: ((ready: boolean) => void) | undefined;
    const r = await renderer(
      () => lease(),
      () =>
        new Promise<boolean>((resolve) => {
          loaded = resolve;
        }),
    );
    const title = layer('title', 'text');
    title.assetId = undefined;
    title.text = resolveText(
      { content: 'actual title', style: 'title-serif' },
      0,
      1920,
      1080,
    );
    const abort = new AbortController();
    const result = expect(
      r.render(scene([title]), { capture: true, signal: abort.signal }),
    ).rejects.toThrow('font preparation');
    for (let i = 0; i < 10 && !loaded; i++) await Promise.resolve();
    expect(loaded).toBeDefined();
    abort.abort();
    await result;
    expect(app().render).not.toHaveBeenCalled();
    expect(app().renderer.extract.canvas).not.toHaveBeenCalled();
    loaded?.(true);
    await Promise.resolve();
    expect(app().render).not.toHaveBeenCalled();
    r.destroy();
  });
});

// These assertions inspect mocked Application submissions and real Pixi tree
// structure only. They do not establish GPU pixels, decoder or audible output.
describe('one-Application comparison structure and lifetime', () => {
  const branch = (name: 'current' | 'historical') =>
    must(root().children.find((n) => n.label === `comparison:${name}`));
  const composition = (name: 'current' | 'historical') =>
    must(branch(name).children.find((n) => n.label === `composition:${name}`));
  const mask = (name: 'current' | 'historical') =>
    must(root().children.find((n) => n.label === `wipe:${name}`));
  const title = () => {
    const text = layer('same-title', 'text');
    text.assetId = undefined;
    text.text = resolveText(
      { content: 'Branch title', style: 'caption' },
      0,
      1920,
      1080,
    );
    return text;
  };
  const compare = (
    current = scene([layer()]),
    historical = scene([layer()]),
    split = 0.5,
  ) => ({ current, historical, split });

  it('isolates overlapping clip, asset and resource keys without rewriting IDs; submits once', async () => {
    const historicalPixels = {
      ...pixelSource,
      data: new Uint8Array([0, 0, 255, 255]),
    };
    const requests = vi.fn((request: RendererResourceRequest) => ({
      ...lease('same-key'),
      source: request.branch === 'historical' ? historicalPixels : pixelSource,
    }));
    const r = await renderer(requests);
    const result = await r.renderComparison(compare());
    expect(result).toMatchObject({
      submitted: true,
      retained: false,
      approximations: [],
    });
    expect(
      requests.mock.calls.map(([req]) => [req.branch, req.clipId, req.assetId]),
    ).toEqual([
      ['current', 'a', 'asset:a'],
      ['historical', 'a', 'asset:a'],
    ]);
    const current = must(composition('current').children[0]);
    const historical = must(composition('historical').children[0]);
    expect(current.label).toBe('a');
    expect(historical.label).toBe('a');
    expect(current).not.toBe(historical);
    const a = must(
      current.children[0]?.children[0],
    ) as import('pixi.js').Sprite;
    const b = must(
      historical.children[0]?.children[0],
    ) as import('pixi.js').Sprite;
    expect(a.texture).not.toBe(b.texture);
    expect(a.texture.source.resource).toBe(pixelSource.data);
    expect(b.texture.source.resource).toBe(historicalPixels.data);
    expect(harness.apps).toHaveLength(1);
    expect(app().render).toHaveBeenCalledOnce();
    expect(app().stop).toHaveBeenCalledOnce();
    r.destroy();
  });

  it.each([0, 0.5, 1])(
    'uses complementary screen-space masks at split %s and independent full viewport fits',
    async (split) => {
      const r = await renderer();
      const current = {
        ...scene([layer()]),
        background: [1, 0, 0, 1] as [number, number, number, number],
      };
      const historical = {
        ...scene([layer()]),
        width: 1080,
        height: 1920,
        background: [0, 0, 1, 0.7] as [number, number, number, number],
      };
      await r.renderComparison(compare(current, historical, split));
      expect(root().scale.x).toBe(1);
      expect(composition('current').scale.x).toBeCloseTo(2 / 3);
      expect(composition('historical').scale.x).toBeCloseTo(720 / 1920);
      expect(composition('historical').position.x).toBeCloseTo(
        (1280 - (1080 * 720) / 1920) / 2,
      );
      for (const name of ['current', 'historical'] as const) {
        expect(branch(name).mask).toBe(mask(name));
        expect(branch(name).scale.x).toBe(1);
        expect(app().renderer.background.alpha).toBe(0);
        expect(branch(name).position.x).toBe(0);
        const wipe = mask(name) as import('pixi.js').Graphics;
        const shape = wipe.context.instructions[0];
        expect(shape?.action).toBe('fill');
        if (shape?.action !== 'fill')
          throw new Error('expected rectangle fill');
        const rect = shape.data.path.instructions[0];
        expect(rect?.action).toBe('rect');
        expect(rect?.data.slice(0, 4)).toEqual([
          name === 'current' ? 0 : 1280 * split,
          0,
          name === 'current' ? 1280 * split : 1280 * (1 - split),
          720,
        ]);
        const background = must(
          branch(name).children[0],
        ) as import('pixi.js').Graphics;
        const fill = background.context.instructions[0];
        if (fill?.action !== 'fill')
          throw new Error('expected background fill');
        expect(fill.data.style.color).toBe(
          name === 'current' ? 0xff0000 : 0x0000ff,
        );
        expect(fill.data.style.alpha).toBe(name === 'current' ? 1 : 0.7);
      }
      expect(app().render).toHaveBeenCalledOnce();
      r.destroy();
    },
  );

  it('qualifies media, masks and LUTs for each branch, preserving source time and mask index', async () => {
    const lut = {
      data: new Uint8Array(512 * 512 * 4),
      width: 512,
      height: 512,
    };
    const getResource = vi.fn((request: RendererResourceRequest) =>
      request.role === 'lut'
        ? { key: 'lut', source: lut, width: 512, height: 512 }
        : lease(request.role),
    );
    const r = await renderer(getResource);
    const a = layer();
    a.sourceTime = 7;
    a.mask = {
      assetId: 'mask',
      sourceTime: 3,
      frameIndex: 90,
      mode: 'cutout',
      invert: false,
      feather: 0,
    };
    a.effects = [
      {
        id: 'same-effect',
        kind: 'lut',
        scope: 'all',
        params: { assetId: 'lut' },
      },
    ];
    await r.renderComparison(compare(scene([a]), scene([a])));
    expect(
      getResource.mock.calls.map(([req]) => [
        req.branch,
        req.role,
        req.sourceTime,
        req.frameIndex,
      ]),
    ).toEqual([
      ['current', 'media', 7, undefined],
      ['current', 'mask', 3, 90],
      ['current', 'lut', 7, undefined],
      ['historical', 'media', 7, undefined],
      ['historical', 'mask', 3, 90],
      ['historical', 'lut', 7, undefined],
    ]);
    const aContent = must(composition('current').children[0]?.children[0]);
    const bContent = must(composition('historical').children[0]?.children[0]);
    expect(aContent.filters).toHaveLength(2);
    expect(bContent.filters).toHaveLength(2);
    expect(aContent.filters?.[0]).not.toBe(bContent.filters?.[0]);
    r.destroy();
  });

  it.each(['current', 'historical'] as const)(
    'fails closed on first comparison with %s missing, then retries',
    async (missing) => {
      let ready = false;
      const releases: ReturnType<typeof vi.fn>[] = [];
      const r = await renderer((req) => {
        if (!ready && req.branch === missing) return undefined;
        const release = vi.fn();
        releases.push(release);
        return lease('same-key', release);
      });
      const result = await r.renderComparison(compare());
      expect(result).toMatchObject({ submitted: false, retained: false });
      expect(
        result.approximations.some((a) =>
          a.reason.includes(`${missing}: media resource pending`),
        ),
      ).toBe(true);
      expect(app().render).not.toHaveBeenCalled();
      expect(root().children).toHaveLength(0);
      expect(releases.every((release) => release.mock.calls.length === 1)).toBe(
        true,
      );
      ready = true;
      expect((await r.renderComparison(compare())).submitted).toBe(true);
      r.destroy();
      expect(releases.every((release) => release.mock.calls.length === 1)).toBe(
        true,
      );
    },
  );

  it('retains a previous single framebuffer and tree until both branches are ready', async () => {
    let missing = true;
    const r = await renderer((req) =>
      missing && req.branch === 'historical' ? undefined : lease(),
    );
    await r.render(scene([layer('live')]));
    const live = node();
    const result = await r.renderComparison(compare());
    expect(result).toMatchObject({ submitted: false, retained: true });
    expect(root().children).toEqual([live]);
    expect(live.destroyed).toBe(false);
    expect(app().render).toHaveBeenCalledOnce();
    missing = false;
    await r.renderComparison(compare());
    expect(live.destroyed).toBe(true);
    expect(app().render).toHaveBeenCalledTimes(2);
    r.destroy();
  });

  it('does not resubmit retained mutable videos or change masks when one branch is pending', async () => {
    let ready = true;
    const videos = {
      current: document.createElement('video'),
      historical: document.createElement('video'),
    };
    for (const video of Object.values(videos)) {
      video.width = 16;
      video.height = 9;
      video.src = 'https://media.invalid/pooled.mp4';
    }
    const r = await renderer((req) => {
      if (!ready && req.branch === 'historical') return undefined;
      return {
        key: 'pooled-video',
        source: videos[req.branch ?? 'current'],
        width: 16,
        height: 9,
      };
    });
    await r.renderComparison(
      compare(scene([layer('a', 'video')]), scene([layer('a', 'video')])),
    );
    const current = must(
      composition('current').children[0]?.children[0]?.children[0],
    ) as import('pixi.js').Sprite;
    const update = vi.spyOn(current.texture.source, 'update');
    const rect = (mask('current') as import('pixi.js').Graphics).context
      .instructions[0];
    ready = false;
    const result = await r.renderComparison(
      compare(scene([layer('a', 'video')]), scene([layer('a', 'video')]), 0.9),
    );
    expect(result).toMatchObject({ submitted: false, retained: true });
    expect(app().render).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    expect(
      (mask('current') as import('pixi.js').Graphics).context.instructions[0],
    ).toBe(rect);
    r.destroy();
    expect(videos.current.src).toBe('https://media.invalid/pooled.mp4');
    expect(videos.historical.src).toBe('https://media.invalid/pooled.mp4');
  });

  it('waits for independent branch font loads and never submits a first-frame fallback', async () => {
    const loads: ((ready: boolean) => void)[] = [];
    const loadFont = vi.fn(
      () => new Promise<boolean>((resolve) => loads.push(resolve)),
    );
    const r = await renderer(() => lease(), loadFont);
    const rendering = r.renderComparison(
      compare(scene([title()]), scene([title()])),
    );
    await vi.waitFor(() => expect(loads).toHaveLength(2));
    loads[0]?.(true);
    await Promise.resolve();
    expect(app().render).not.toHaveBeenCalled();
    loads[1]?.(false);
    const result = await rendering;
    expect(result).toMatchObject({ submitted: false, retained: false });
    expect(
      result.approximations.some((a) =>
        a.reason.includes('historical: canvas font unavailable'),
      ),
    ).toBe(true);
    expect(harness.texts).toHaveLength(0);
    const retry = r.renderComparison(
      compare(scene([title()]), scene([title()])),
    );
    await vi.waitFor(() => expect(loads).toHaveLength(3));
    loads[2]?.(true);
    expect((await retry).submitted).toBe(true);
    expect(harness.texts).toHaveLength(2);
    r.destroy();
  });

  it.each(['cancel', 'exit', 'dispose'] as const)(
    'releases both pending branches promptly on %s without a late submission',
    async (action) => {
      const releases: ReturnType<typeof vi.fn>[] = [];
      const loads: ((ready: boolean) => void)[] = [];
      const r = await renderer(
        () => {
          const release = vi.fn();
          releases.push(release);
          return lease('same', release);
        },
        () => new Promise<boolean>((resolve) => loads.push(resolve)),
      );
      const rendering = r.renderComparison(
        compare(scene([layer(), title()]), scene([layer(), title()])),
      );
      await vi.waitFor(() => expect(loads).toHaveLength(2));
      if (action === 'dispose') r.destroy();
      else if (action === 'exit') await r.render(scene([]));
      else r.cancelPending();
      expect((await rendering).submitted).toBe(false);
      expect(releases.every((release) => release.mock.calls.length === 1)).toBe(
        true,
      );
      loads.forEach((resolve) => resolve(true));
      await Promise.resolve();
      expect(app().render).toHaveBeenCalledTimes(action === 'exit' ? 1 : 0);
      r.destroy();
      expect(releases.every((release) => release.mock.calls.length === 1)).toBe(
        true,
      );
    },
  );

  it('releases branch textures, masks, filters and fonts once on exit; live capture still uses undefined branch', async () => {
    const releases: ReturnType<typeof vi.fn>[] = [];
    const getResource = vi.fn((request: RendererResourceRequest) => {
      void request;
      const release = vi.fn();
      releases.push(release);
      return lease('shared', release);
    });
    const loadFont = vi.fn(async () => true);
    const r = await renderer(getResource, loadFont);
    const a = layer();
    a.effects = [
      { id: 'grade', kind: 'grade', params: { exposure: 1 }, scope: 'all' },
    ];
    await r.renderComparison(compare(scene([a, title()]), scene([a, title()])));
    const wrappers = [branch('current'), branch('historical')];
    const masks = [mask('current'), mask('historical')];
    const destroys = wrappers.map((wrapper) => vi.spyOn(wrapper, 'destroy'));
    const maskDestroys = masks.map((wipe) => vi.spyOn(wipe, 'destroy'));
    const filter = must(
      composition('current').children[0]?.children[0]?.filters?.[0],
    );
    const filterDestroy = vi.spyOn(filter, 'destroy');
    const capture = await r.render(scene([layer('live')]), { capture: true });
    expect(capture.frame?.blob.type).toBe('image/png');
    expect(getResource.mock.calls.at(-1)?.[0]).toMatchObject({
      branch: undefined,
    });
    expect(root().children.map((child) => child.label)).toEqual(['live']);
    expect(filterDestroy).toHaveBeenCalledOnce();
    expect(destroys.every((destroy) => destroy.mock.calls.length === 1)).toBe(
      true,
    );
    expect(
      maskDestroys.every((destroy) => destroy.mock.calls.length === 1),
    ).toBe(true);
    expect(
      releases.slice(0, 2).every((release) => release.mock.calls.length === 1),
    ).toBe(true);
    await r.renderComparison(compare(scene([title()]), scene([title()])));
    expect(loadFont).toHaveBeenCalledTimes(4);
    r.destroy();
    r.destroy();
    expect(filterDestroy).toHaveBeenCalledOnce();
    expect(destroys.every((destroy) => destroy.mock.calls.length === 1)).toBe(
      true,
    );
    expect(
      maskDestroys.every((destroy) => destroy.mock.calls.length === 1),
    ).toBe(true);
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it('rejects comparison capture and invalid splits without exporting or submitting a wipe', async () => {
    const r = await renderer();
    await expect(
      r.renderComparison(compare(), { capture: true }),
    ).rejects.toThrow('during comparison');
    for (const split of [-1, 1.1, NaN, Infinity])
      await expect(
        r.renderComparison(compare(undefined, undefined, split)),
      ).rejects.toThrow('invalid comparison split');
    expect(app().renderer.extract.canvas).not.toHaveBeenCalled();
    expect(app().render).not.toHaveBeenCalled();
    r.destroy();
  });
});

describe('comparison transition and failure isolation (not GPU acceptance)', () => {
  const composition = (branch: 'current' | 'historical') => {
    const wrapper = must(
      root().children.find((n) => n.label === `comparison:${branch}`),
    );
    return must(
      wrapper.children.find((n) => n.label === `composition:${branch}`),
    );
  };
  function paired(blackWeight: number): SceneGraph {
    return {
      ...scene([layer('out'), layer('in')]),
      transitionPairs: [
        {
          id: 'same-pair',
          trackId: 'v',
          kind: blackWeight ? 'dip' : 'crossfade',
          outgoingClipId: 'out',
          incomingClipId: 'in',
          compositeAtClipId: 'in',
          boundary: 1,
          start: 0.5,
          end: 1.5,
          progress: 0.5,
          durationSec: 1,
          direction: 'left',
          composite: 'premultiplied_mix',
          outgoingWeight: blackWeight ? 0 : 0.5,
          incomingWeight: blackWeight ? 0 : 0.5,
          blackWeight,
        },
      ],
    };
  }
  it('keeps same-ID transition groups, black planes, member filters and ordering branch-local through reconciliation', async () => {
    const r = await renderer((req) => lease(req.clipId));
    const current = paired(0),
      historical = { ...paired(1), width: 1080, height: 1920 };
    await r.renderComparison({ current, historical, split: 0.5 });
    const a = must(composition('current').children[0]);
    const b = must(composition('historical').children[0]);
    expect(a.label).toBe('transition:same-pair');
    expect(b.label).toBe(a.label);
    expect(a).not.toBe(b);
    expect(a.children.map((child) => child.label)).toEqual([
      'Graphics',
      'out',
      'in',
    ]);
    expect(a.children[0]?.alpha).toBe(0);
    expect(b.children[0]?.alpha).toBe(1);
    expect(a.children[1]?.alpha).toBe(0.5);
    expect(b.children[1]?.alpha).toBe(0);
    expect(a.filters?.[0]).not.toBe(b.filters?.[0]);
    expect(a.children[1]?.filters?.[0]).not.toBe(b.children[1]?.filters?.[0]);
    const filterDestroy = vi.spyOn(must(a.filters?.[0]), 'destroy');
    const blackDestroy = vi.spyOn(must(a.children[0]), 'destroy');
    const pairDestroy = vi.spyOn(a, 'destroy');
    await r.renderComparison({
      current: scene([layer('in'), layer('out')]),
      historical,
      split: 0.75,
    });
    expect(composition('current').children.map((child) => child.label)).toEqual(
      ['in', 'out'],
    );
    expect(composition('historical').children[0]).toBe(b);
    expect(filterDestroy).toHaveBeenCalledOnce();
    expect(blackDestroy).toHaveBeenCalledOnce();
    expect(pairDestroy).toHaveBeenCalledOnce();
    expect(app().render).toHaveBeenCalledTimes(2);
    r.destroy();
    expect(filterDestroy).toHaveBeenCalledOnce();
    expect(blackDestroy).toHaveBeenCalledOnce();
    expect(pairDestroy).toHaveBeenCalledOnce();
  });

  it.each(['throw', 'dimensions', 'buffer', 'lut', 'font-rejection'] as const)(
    'fails closed initially for %s and releases prepared leases exactly once',
    async (failure) => {
      const releases: ReturnType<typeof vi.fn>[] = [];
      const r = await renderer(
        (req) => {
          if (failure === 'throw' && req.branch === 'historical')
            throw new Error('unavailable');
          const release = vi.fn();
          releases.push(release);
          const resource = lease(req.role, release);
          if (req.branch !== 'historical') return resource;
          if (failure === 'dimensions') return { ...resource, width: 0 };
          if (failure === 'buffer') return { ...resource, width: 2 };
          return resource; // LUT 1x1 is intentionally invalid on either side.
        },
        async () => {
          throw new Error('font unavailable');
        },
      );
      const a = layer();
      if (failure === 'lut')
        a.effects = [
          { id: 'lut', kind: 'lut', scope: 'all', params: { assetId: 'lut' } },
        ];
      if (failure === 'font-rejection') {
        a.kind = 'text';
        a.assetId = undefined;
        a.text = resolveText(
          { content: 'text', style: 'caption' },
          0,
          1920,
          1080,
        );
      }
      const result = await r.renderComparison({
        current: scene([a]),
        historical: scene([a]),
        split: 0.5,
      });
      expect(result).toMatchObject({ submitted: false, retained: false });
      expect(result.approximations.length).toBeGreaterThan(0);
      expect(app().render).not.toHaveBeenCalled();
      r.destroy();
      expect(releases.every((release) => release.mock.calls.length === 1)).toBe(
        true,
      );
    },
  );

  it('preserves branch-qualified timestamp degradation instead of claiming a fresh frame', async () => {
    const r = await renderer((req) => ({
      ...lease(),
      approximation: `${req.branch} source timestamp drift; held frame`,
    }));
    const result = await r.renderComparison({
      current: scene([layer()]),
      historical: scene([layer()]),
      split: 0.5,
    });
    expect(result.approximations.map((a) => a.reason)).toEqual([
      'current: current source timestamp drift; held frame',
      'historical: historical source timestamp drift; held frame',
    ]);
    expect(result.submitted).toBe(true); // Explicit degradation, never an unqualified fresh claim.
    r.destroy();
  });

  it('refits each complete composition after resize without a new app or changing half-width scale', async () => {
    const r = await renderer();
    const current = scene([layer()]),
      historical = { ...scene([layer()]), width: 1080, height: 1920 };
    await r.renderComparison({ current, historical, split: 0.1 });
    const currentNode = composition('current').children[0];
    const historicalNode = composition('historical').children[0];
    r.resize(720, 1280);
    await r.renderComparison({ current, historical, split: 0.9 });
    expect(composition('current').scale.x).toBeCloseTo(720 / 1920);
    expect(composition('historical').scale.x).toBeCloseTo(2 / 3);
    expect(composition('current').children[0]).toBe(currentNode);
    expect(composition('historical').children[0]).toBe(historicalNode);
    expect(harness.apps).toHaveLength(1);
    expect(app().render).toHaveBeenCalledTimes(2);
    r.destroy();
  });
});
