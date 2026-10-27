import type * as PIXI from 'pixi.js';
import type { LiveFilter, FilterMode } from './filters';
import type {
  Approximation,
  ResolvedLayer,
  ResolvedText,
  ResolvedTransitionPair,
  SceneGraph,
} from './types';
import type {
  PreparedRendererResource,
  RendererInit,
  RendererOptions,
  RendererResourceRequest,
  RenderResult,
  SceneRenderer,
} from './renderer-types';
export type {
  PreparedRendererResource,
  RendererInit,
  RendererOptions,
  RendererResourceRequest,
  RenderResult,
} from './renderer-types';

type Pixi = typeof PIXI;
function required<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('renderer invariant: missing initialized state');
  return value;
}
interface CachedTexture {
  texture: PIXI.Texture;
  refs: number;
  lease: PreparedRendererResource;
  revision?: string | number;
}
interface LayerNode {
  kind: ResolvedLayer['kind'];
  container: PIXI.Container;
  content: PIXI.Container;
  crop: PIXI.Graphics;
  sprite?: PIXI.Sprite;
  resources: Set<string>;
  filters: Map<string, LiveFilter>;
  contentSignature?: string;
  wordTexts?: PIXI.Text[];
  pairBlend?: LiveFilter;
}
interface PairNode {
  container: PIXI.Container;
  filter: LiveFilter;
  black: PIXI.Graphics;
  size: string;
}
/** Controller-selected output size helper. No device reads or adaptive clock here. */
export function fitViewport(
  projectWidth: number,
  projectHeight: number,
  deviceWidth: number,
  deviceHeight: number,
  lowQuality = false,
): { width: number; height: number } {
  const portrait = projectHeight > projectWidth;
  const long = lowQuality ? 1280 : 1920,
    short = lowQuality ? 720 : 1080;
  const s = Math.min(
    Math.max(1, deviceWidth) / projectWidth,
    Math.max(1, deviceHeight) / projectHeight,
    (portrait ? short : long) / projectWidth,
    (portrait ? long : short) / projectHeight,
  );
  return {
    width: Math.max(1, Math.floor(projectWidth * s)),
    height: Math.max(1, Math.floor(projectHeight * s)),
  };
}
const effectModes: Readonly<Record<string, FilterMode>> = {
  colour_grade: 'grade',
  color_grade: 'grade',
  grade: 'grade',
  exposure: 'grade',
  contrast: 'grade',
  saturation: 'grade',
  temperature: 'grade',
  tint: 'grade',
  lift_gamma_gain: 'grade',
  vignette: 'vignette',
  grain: 'grain',
  film_grain: 'grain',
  sharpen: 'sharpen',
  black_white: 'bw',
  black_and_white: 'bw',
  bw: 'bw',
  lut: 'lut',
  blur: 'blur',
  gaussian_blur: 'blur',
  whip: 'whip',
};
/** Retained scene graph. Only render() submits frames; there is no internal scheduler. */
export class PixiRenderer implements SceneRenderer {
  private pixi?: Pixi;
  private FilterClass?: typeof LiveFilter;
  private app?: PIXI.Application;
  private root?: PIXI.Container;
  private readonly nodes = new Map<string, LayerNode>();
  private readonly pairs = new Map<string, PairNode>();
  private readonly textures = new Map<string, CachedTexture>();
  private readonly fonts = new Map<string, Promise<boolean>>();
  private revision = 0;
  private readonly pendingPreparations = new Map<number, () => void>();
  private disposed = false;
  private hasFrame = false;
  private viewport = { width: 1, height: 1 };
  private initializing?: Promise<void>;
  constructor(private readonly options: RendererOptions = {}) {}
  init(options: RendererInit): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('renderer disposed'));
    if (this.initializing) return this.initializing;
    this.initializing = this.initialize(options);
    return this.initializing;
  }
  private async initialize(options: RendererInit): Promise<void> {
    const [pixi, filters] = await Promise.all([
      import('pixi.js'),
      import('./filters'),
    ]);
    if (this.disposed) return;
    this.pixi = pixi;
    this.FilterClass = filters.LiveFilter;
    let app = new pixi.Application();
    try {
      await app.init({
        canvas: options.canvas,
        width: options.width,
        height: options.height,
        resolution: options.resolution ?? 1,
        preference: ['webgpu', 'webgl'],
        autoStart: false,
        sharedTicker: false,
        autoDensity: false,
        backgroundAlpha: 1,
      });
    } catch (preferredError) {
      // Preference selection alone does not retry a backend that fails during init.
      if (app.renderer) app.destroy({ removeView: false }, { children: true });
      else app.stage.destroy({ children: true });
      if (this.disposed) return;
      app = new pixi.Application();
      try {
        await app.init({
          canvas: options.canvas,
          width: options.width,
          height: options.height,
          resolution: options.resolution ?? 1,
          preference: ['webgl'],
          autoStart: false,
          sharedTicker: false,
          autoDensity: false,
          backgroundAlpha: 1,
        });
      } catch (fallbackError) {
        if (app.renderer)
          app.destroy({ removeView: false }, { children: true });
        else app.stage.destroy({ children: true });
        throw new AggregateError(
          [preferredError, fallbackError],
          'WebGPU/WebGL preview initialization failed',
        );
      }
    }
    app.stop();
    if (this.disposed) {
      app.destroy({ removeView: false }, { children: true });
      return;
    }
    this.app = app;
    this.root = app.stage;
    this.root.eventMode = 'none';
    this.root.enableRenderGroup();
    this.viewport = { width: options.width, height: options.height };
  }
  resize(width: number, height: number, resolution = 1): void {
    if (!this.app || this.disposed) return;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      !Number.isFinite(resolution) ||
      resolution <= 0
    )
      throw new Error('invalid viewport');
    this.viewport = { width, height };
    this.app.renderer.resize(width, height, resolution);
  }
  private acquire(resource: PreparedRendererResource): CachedTexture {
    const prior = this.textures.get(resource.key);
    if (prior) {
      const video =
        typeof HTMLVideoElement !== 'undefined' &&
        resource.source instanceof HTMLVideoElement;
      if (
        (video && resource.revision === undefined) ||
        resource.revision !== prior.revision
      ) {
        prior.texture.source.resize(resource.width, resource.height);
        prior.texture.source.update();
        prior.revision = resource.revision;
      }
      resource.release?.();
      return prior;
    }
    const pixi = required(this.pixi);
    const source =
      'data' in resource.source
        ? new pixi.BufferImageSource({
            resource: resource.source.data,
            width: resource.width,
            height: resource.height,
            format: 'rgba8unorm',
            alphaMode: 'premultiplied-alpha',
          })
        : new pixi.ImageSource({
            resource: resource.source,
            width: resource.width,
            height: resource.height,
            alphaMode: 'premultiply-alpha-on-upload',
          });
    const entry = {
      texture: new pixi.Texture({ source }),
      refs: 0,
      lease: resource,
      revision: resource.revision,
    };
    this.textures.set(resource.key, entry);
    return entry;
  }
  private release(key: string): void {
    const entry = this.textures.get(key);
    if (!entry) return;
    if (--entry.refs > 0) return;
    entry.texture.destroy(true);
    entry.lease.release?.();
    this.textures.delete(key);
  }
  private destroyNode(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.content.filters = [];
    node.container.filters = [];
    node.pairBlend?.destroy();
    node.filters.forEach((filter) => filter.destroy());
    node.container.destroy({
      children: true,
      texture: false,
      textureSource: false,
    });
    node.resources.forEach((key) => this.release(key));
    this.nodes.delete(id);
  }
  private createNode(layer: ResolvedLayer): LayerNode {
    const p = required(this.pixi);
    const container = new p.Container({
        label: layer.clipId,
        eventMode: 'none',
      }),
      content = new p.Container(),
      crop = new p.Graphics();
    container.addChild(content, crop);
    required(this.root).addChild(container);
    const node: LayerNode = {
      kind: layer.kind,
      container,
      content,
      crop,
      resources: new Set(),
      filters: new Map(),
    };
    this.nodes.set(layer.clipId, node);
    return node;
  }
  private async fontReady(text: ResolvedText): Promise<boolean> {
    const load = (css: string, content: string) => {
      const key = `${css}:${content}`;
      let ready = this.fonts.get(key);
      if (!ready) {
        ready = Promise.resolve()
          .then(
            () =>
              this.options.loadFont?.(css, content) ??
              (typeof document !== 'undefined' && document.fonts
                ? document.fonts.load(css, content).then((f) => f.length > 0)
                : false),
          )
          .catch(() => false);
        if (this.fonts.size >= 128) {
          const oldest = this.fonts.keys().next().value;
          if (oldest !== undefined) this.fonts.delete(oldest);
        }
        this.fonts.set(key, ready);
      }
      return ready;
    };
    const s = text.style;
    const primary = load(
      `${s.fontStyle} ${s.fontWeight} ${s.fontSize}px "${s.fontFamily}"`,
      text.content,
    );
    const secondary =
      s.secondary && text.secondaryContent
        ? load(
            `normal ${s.secondary.fontWeight} ${s.secondary.fontSize}px "${s.secondary.fontFamily}"`,
            text.secondaryContent,
          )
        : Promise.resolve(true);
    const results = await Promise.all([primary, secondary]);
    return results.every(Boolean);
  }
  /** Invalidate async preparations without touching the last submitted framebuffer. */
  cancelPending(): void {
    ++this.revision;
    this.pendingPreparations.forEach((cancel) => cancel());
    this.pendingPreparations.clear();
  }
  async render(scene: SceneGraph): Promise<RenderResult> {
    if (!this.app || !this.root || this.disposed)
      throw new Error('renderer not initialized');
    const revision = ++this.revision;
    this.pendingPreparations.forEach((cancel) => cancel());
    this.pendingPreparations.clear();
    const approximations: Approximation[] = [...scene.approximations];
    const seen = new Set(
      approximations.map((a) => JSON.stringify([a.clipId, a.reason])),
    );
    const warn = (clipId: string, reason: string) => {
      const key = JSON.stringify([clipId, reason]);
      if (!seen.has(key)) {
        seen.add(key);
        approximations.push({ clipId, reason });
      }
    };
    const prepared = new Map<string, Map<string, PreparedRendererResource>>();
    let pending = false;
    const identities = new Map<string, PreparedRendererResource['source']>();
    for (const layer of scene.layers) {
      layer.approximations.forEach((reason) => warn(layer.clipId, reason));
      const resources = new Map<string, PreparedRendererResource>();
      prepared.set(layer.clipId, resources);
      const request = (
        role: RendererResourceRequest['role'],
        assetId: string,
        slot: string = role,
      ) => {
        let resource: PreparedRendererResource | undefined;
        try {
          resource = this.options.getResource?.({
            clipId: layer.clipId,
            assetId,
            sourceTime:
              role === 'mask'
                ? (layer.mask?.sourceTime ?? layer.sourceTime)
                : layer.sourceTime,
            role,
            frameIndex: role === 'mask' ? layer.mask?.frameIndex : undefined,
          });
        } catch (error) {
          warn(
            layer.clipId,
            `${role} preparation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
        if (
          resource &&
          (!Number.isSafeInteger(resource.width) ||
            !Number.isSafeInteger(resource.height) ||
            resource.width <= 0 ||
            resource.height <= 0)
        ) {
          resource.release?.();
          resource = undefined;
          warn(layer.clipId, `${role} dimensions invalid`);
        }
        if (
          resource &&
          role === 'lut' &&
          (resource.width !== 512 || resource.height !== 512)
        ) {
          resource.release?.();
          warn(layer.clipId, 'LUT must be a 512x512 atlas; base preview');
          return;
        }

        if (
          resource &&
          'data' in resource.source &&
          (resource.source.data.length !==
            resource.width * resource.height * 4 ||
            resource.source.width !== resource.width ||
            resource.source.height !== resource.height)
        ) {
          resource.release?.();
          resource = undefined;
          warn(layer.clipId, `${role} RGBA buffer dimensions invalid`);
        }
        if (resource) {
          const old =
            this.textures.get(resource.key)?.lease.source ??
            identities.get(resource.key);
          const same =
            !old ||
            old === resource.source ||
            ('data' in old &&
              'data' in resource.source &&
              old.data === resource.source.data);
          if (!same) {
            resource.release?.();
            resource = undefined;
            warn(
              layer.clipId,
              `${role} resource key reused for a different source`,
            );
          }
        }
        if (resource) {
          identities.set(resource.key, resource.source);
          resources.set(slot, resource);
          if (resource.approximation)
            warn(layer.clipId, resource.approximation);
        } else {
          pending = true;
          warn(layer.clipId, `${role} resource pending: ${assetId}`);
        }
      };
      if ((layer.kind === 'video' || layer.kind === 'image') && layer.assetId)
        request('media', layer.assetId);
      if (
        (layer.kind === 'video' || layer.kind === 'image') &&
        !layer.assetId
      ) {
        pending = true;
        warn(layer.clipId, 'media asset absent');
      }
      if (layer.mask) request('mask', layer.mask.assetId);
      for (const effect of layer.effects)
        if (
          effectModes[effect.kind] === 'lut' ||
          typeof effect.params.lutAssetId === 'string'
        ) {
          const id = effect.params.assetId ?? effect.params.lutAssetId;
          if (typeof id === 'string') request('lut', id, `lut:${effect.id}`);
          else warn(layer.clipId, 'LUT asset ID absent');
        }
    }
    let preparedReleased = false;
    const releasePrepared = () => {
      if (preparedReleased) return;
      preparedReleased = true;
      prepared.forEach((resources) => resources.forEach((r) => r.release?.()));
      this.pendingPreparations.delete(revision);
    };
    this.pendingPreparations.set(revision, releasePrepared);
    // Do not mutate the display tree or last-good textures while any resource is pending.
    if (pending && this.hasFrame) {
      releasePrepared();
      return { submitted: false, retained: true, approximations };
    }
    const fontResults = await Promise.all(
      scene.layers.map(async (l) => !l.text || (await this.fontReady(l.text))),
    );
    if (this.disposed || revision !== this.revision) {
      releasePrepared();
      return { submitted: false, retained: this.hasFrame, approximations };
    }
    scene.layers.forEach((l, i) => {
      if (!fontResults[i])
        warn(l.clipId, 'canvas font unavailable; system fallback');
    });
    try {
      this.root.scale.set(
        Math.min(
          this.viewport.width / scene.width,
          this.viewport.height / scene.height,
        ),
      );
      this.root.position.set(
        (this.viewport.width - scene.width * this.root.scale.x) / 2,
        (this.viewport.height - scene.height * this.root.scale.y) / 2,
      );
      const visible = new Set(scene.layers.map((l) => l.clipId));
      for (const id of this.nodes.keys())
        if (!visible.has(id)) this.destroyNode(id);
      scene.layers.forEach((layer) => {
        let node = this.nodes.get(layer.clipId);
        if (node && node.kind !== layer.kind) {
          this.destroyNode(layer.clipId);
          node = undefined;
        }
        node ??= this.createNode(layer);

        const resources = required(prepared.get(layer.clipId));
        const next = new Set<string>();
        const slots = new Map<string, PIXI.Texture>();
        for (const [slot, resource] of resources) {
          const entry = this.acquire(resource);
          resources.delete(slot);
          slots.set(slot, entry.texture);
          if (!next.has(resource.key)) {
            next.add(resource.key);
            if (!node.resources.has(resource.key)) entry.refs++;
          }
        }
        const old = node.resources;
        node.resources = next;
        this.updateNode(node, layer, scene, slots, warn);
        // Release only after sprite/filter references point at the newly prepared textures.
        old.forEach((key) => {
          if (!next.has(key)) this.release(key);
        });
      });
      this.compositePairs(scene, warn);
      this.app.render();
      this.hasFrame = true;
      return { submitted: true, retained: false, approximations };
    } finally {
      releasePrepared();
    }
  }
  private destroyPair(id: string): void {
    const pair = this.pairs.get(id);
    if (!pair) return;
    for (const node of this.nodes.values())
      if (node.container.parent === pair.container)
        required(this.root).addChild(node.container);
    pair.container.filters = [];
    pair.filter.destroy();
    pair.black.destroy();
    pair.container.destroy({ children: false });
    this.pairs.delete(id);
  }
  private compositePairs(
    scene: SceneGraph,
    warn: (id: string, reason: string) => void,
  ): void {
    const pairs: ResolvedTransitionPair[] = [];
    const byClip = new Map<string, ResolvedTransitionPair>();
    for (const pair of scene.transitionPairs ?? []) {
      if (
        !this.nodes.has(pair.outgoingClipId) ||
        !this.nodes.has(pair.incomingClipId) ||
        byClip.has(pair.outgoingClipId) ||
        byClip.has(pair.incomingClipId)
      ) {
        warn(
          pair.incomingClipId,
          'transition pair members missing or overlapping; base preview',
        );
        continue;
      }
      pairs.push(pair);
      byClip.set(pair.outgoingClipId, pair);
      byClip.set(pair.incomingClipId, pair);
    }
    const active = new Set(pairs.map((p) => p.id));
    for (const id of this.pairs.keys())
      if (!active.has(id)) this.destroyPair(id);
    for (const [id, node] of this.nodes)
      if (!byClip.has(id) && node.pairBlend) {
        node.container.filters = [];
        node.pairBlend.destroy();
        node.pairBlend = undefined;
      }
    const p = required(this.pixi);
    for (const descriptor of pairs) {
      let pair = this.pairs.get(descriptor.id);
      if (!pair) {
        const container = new p.Container({
            label: `transition:${descriptor.id}`,
            eventMode: 'none',
          }),
          black = new p.Graphics(),
          filter = new (required(this.FilterClass))();
        filter.configure('mask', {}, scene.frame);
        container.filters = [filter];
        container.addChild(black);
        required(this.root).addChild(container);
        pair = { container, black, filter, size: '' };
        this.pairs.set(descriptor.id, pair);
      }
      const size = `${scene.width}:${scene.height}`;
      if (pair.size !== size) {
        pair.black.clear().rect(0, 0, scene.width, scene.height).fill(0);
        pair.size = size;
      }
      pair.black.alpha = descriptor.blackWeight;
      pair.black.visible = descriptor.blackWeight > 0;
      pair.black.blendMode =
        descriptor.composite === 'premultiplied_mix' ? 'add' : 'normal';
      const outgoing = required(this.nodes.get(descriptor.outgoingClipId)),
        incoming = required(this.nodes.get(descriptor.incomingClipId));
      pair.container.addChild(outgoing.container, incoming.container);
      for (const [member, weight] of [
        [outgoing, descriptor.outgoingWeight],
        [incoming, descriptor.incomingWeight],
      ] as const) {
        if (descriptor.composite === 'premultiplied_mix') {
          member.pairBlend ??= new (required(this.FilterClass))();
          member.pairBlend.configure('mask', {}, scene.frame);
          member.pairBlend.blendMode = 'add';
          member.container.filters = [member.pairBlend];
          member.container.alpha *= weight;
        } else if (member.pairBlend) {
          member.container.filters = [];
          member.pairBlend.destroy();
          member.pairBlend = undefined;
        }
      }
    }
    let index = 0;
    for (const layer of scene.layers) {
      const pair = byClip.get(layer.clipId);
      if (pair && pair.compositeAtClipId !== layer.clipId) continue;
      const display = pair
        ? required(this.pairs.get(pair.id)).container
        : required(this.nodes.get(layer.clipId)).container;
      if (display.parent !== this.root) required(this.root).addChild(display);
      required(this.root).setChildIndex(display, index++);
    }
  }
  private updateNode(
    node: LayerNode,
    layer: ResolvedLayer,
    scene: SceneGraph,
    slots: Map<string, PIXI.Texture>,
    warn: (id: string, reason: string) => void,
  ): void {
    const p = required(this.pixi),
      container = node.container;
    container.position.set(
      scene.width / 2 + layer.transform.x,
      scene.height / 2 + layer.transform.y,
    );
    container.rotation = (layer.transform.rotation * Math.PI) / 180;
    container.alpha = layer.opacity;
    container.scale.set(layer.transform.scale);
    const media = slots.get('media');
    if (media) {
      if (!node.sprite) {
        node.sprite = new p.Sprite(media);
        node.sprite.anchor.set(0.5);
        node.content.addChild(node.sprite);
      } else node.sprite.texture = media;
      const fit = Math.min(
        scene.width / media.width,
        scene.height / media.height,
      );
      node.sprite.scale.set(fit);
      const w = media.width * fit,
        h = media.height * fit,
        c = layer.crop;
      node.crop.clear();
      if (c && (c.l + c.r >= 1 || c.t + c.b >= 1)) {
        node.content.mask = null;
        warn(
          layer.clipId,
          'crop outside normalized bounds; base media preview',
        );
      } else if (c) {
        node.crop
          .rect(
            -w / 2 + w * c.l,
            -h / 2 + h * c.t,
            w * (1 - c.l - c.r),
            h * (1 - c.t - c.b),
          )
          .fill(0xffffff);
        node.content.mask = node.crop;
      } else node.content.mask = null;
    } else if (layer.kind === 'text' && layer.text)
      this.updateText(node, layer.text, scene);
    else if (layer.kind === 'shape' && layer.shape) {
      const signature = JSON.stringify(layer.shape);
      if (node.contentSignature !== signature) {
        this.clearContent(node);
        const shape = layer.shape,
          g = new p.Graphics();
        const color = (c: readonly number[]) => ({
          color: [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0] as [number, number, number],
          alpha: c[3] ?? 1,
        });
        if (shape.kind === 'rect') {
          g.roundRect(
            -shape.width / 2,
            -shape.height / 2,
            shape.width,
            shape.height,
            shape.radius ?? 0,
          ).fill(color(shape.fill));
          if (shape.stroke)
            g.stroke({ ...color(shape.stroke), width: shape.strokeWidth ?? 1 });
        } else
          g.moveTo(shape.x1, shape.y1)
            .lineTo(shape.x2, shape.y2)
            .stroke({ ...color(shape.stroke), width: shape.strokeWidth });
        node.content.addChild(g);
        node.contentSignature = signature;
      }
    } else if (layer.kind === 'adjustment')
      warn(
        layer.clipId,
        'adjustment layer backdrop scope undefined; base preview',
      );
    else if (!media && layer.kind !== 'text')
      warn(
        layer.clipId,
        'layer resource or geometry unavailable; base preview',
      );
    if (layer.mask && !layer.mask.metadata)
      warn(
        layer.clipId,
        'mask channel metadata absent; red-channel approximation',
      );
    if (layer.mask && !node.sprite)
      warn(
        layer.clipId,
        'mask on non-media content uses local bounds; source-UV mapping unverified',
      );
    const mask = slots.get('mask'),
      active = new Set<string>(),
      chain: LiveFilter[] = [];
    const append = (
      id: string,
      mode: FilterMode,
      params: Record<string, string | number | boolean>,
      scope: 'all' | 'inside_mask' | 'outside_mask' = 'all',
      lut?: PIXI.Texture,
    ) => {
      if (scope !== 'all' && !mask) {
        warn(layer.clipId, 'scoped effect awaiting mask; base preview');
        return;
      }
      let filter = node.filters.get(id);
      if (!filter) {
        filter = new (required(this.FilterClass))();
        node.filters.set(id, filter);
      }
      const issues = filter.configure(
        mode,
        params,
        scene.frame,
        scope,
        mask,
        lut,
        layer.mask?.invert,
        layer.mask?.feather,
        layer.mask?.metadata?.channel ?? 'red',
        required(this.root).scale.x,
      );
      issues.forEach((reason) => warn(layer.clipId, reason));
      filter.setMapping(node.sprite);
      active.add(id);
      chain.push(filter);
    };
    for (const effect of layer.effects) {
      if (effect.kind === 'zoom_punch' || effect.kind === 'zoom_punch_in')
        continue;
      const mode = effectModes[effect.kind];
      if (!mode) {
        warn(layer.clipId, `unsupported effect ${effect.kind}; base preview`);
        continue;
      }
      const lut = slots.get(`lut:${effect.id}`);
      if (mode === 'lut' && !lut) {
        warn(layer.clipId, 'LUT unavailable; base preview');
        continue;
      }
      if (mode === 'blur') {
        const radius =
          typeof effect.params.radius === 'number'
            ? effect.params.radius
            : typeof effect.params.strength === 'number'
              ? effect.params.strength
              : 8;
        append(
          effect.id,
          mode,
          { ...effect.params, x: radius, y: radius },
          effect.scope,
        );
      } else {
        append(
          JSON.stringify(['effect', effect.id]),
          mode,
          effect.params,
          effect.scope,
          lut,
        );
        if (mode !== 'lut' && typeof effect.params.lutAssetId === 'string') {
          if (lut)
            append(
              JSON.stringify(['effectLut', effect.id]),
              'lut',
              {},
              effect.scope,
              lut,
            );
          else warn(layer.clipId, 'LUT unavailable; base grade only');
        }
      }
    }
    for (const [i, t] of layer.transitions.entries())
      if (t.kind === 'whip' && t.blurPx > 0)
        append(`transition:${i}`, 'whip', {
          x:
            t.direction === 'left'
              ? -t.blurPx
              : t.direction === 'right'
                ? t.blurPx
                : 0,
          y:
            t.direction === 'up'
              ? -t.blurPx
              : t.direction === 'down'
                ? t.blurPx
                : 0,
        });
    if (layer.mask?.mode === 'cutout' && mask) append('cutout', 'mask', {});
    node.content.filters = chain;
    for (const [id, filter] of node.filters)
      if (!active.has(id)) {
        filter.destroy();
        node.filters.delete(id);
      }
  }
  private clearContent(node: LayerNode): void {
    for (const child of node.content.removeChildren())
      child.destroy({ children: true, texture: false, textureSource: false });
    node.sprite = undefined;
    node.wordTexts = undefined;
  }
  private updateText(
    node: LayerNode,
    text: ResolvedText,
    scene: SceneGraph,
  ): void {
    const signature = JSON.stringify({
      ...text,
      words: text.words.map((w) => w.text),
    });
    if (node.contentSignature === signature) {
      node.wordTexts?.forEach((word, index) => {
        word.style.fill =
          text.words[index]?.active && text.style.activeWordColor
            ? text.style.activeWordColor
            : text.style.fill;
      });
      return;
    }
    this.clearContent(node);
    node.contentSignature = signature;
    const p = required(this.pixi),
      s = text.style,
      scale = text.scale;
    const style: Partial<PIXI.TextStyleOptions> = {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize * scale,
      fontWeight: String(s.fontWeight) as '400' | '500',
      fontStyle: s.fontStyle,
      fill: s.fill,
      wordWrap: true,
      wordWrapWidth: text.safeRect.width,
      breakWords: true,
      align: s.placement === 'lower-left' ? 'left' : 'center',
      ...(s.stroke
        ? {
            stroke: {
              color: s.stroke.color,
              alpha: s.stroke.alpha,
              width: s.stroke.width * scale,
            },
          }
        : {}),
    };
    const block = new p.Container();
    if (s.activeWordColor && text.words.length) {
      // Build wrapping rows with actual loaded-font measurements, then center each row.
      const rows: PIXI.Text[][] = [[]];
      node.wordTexts = [];
      let rowWidth = 0;
      const space = p.CanvasTextMetrics.measureText(
        ' ',
        new p.TextStyle(style),
      ).width;
      for (const word of text.words) {
        const t = new p.Text({
          text: word.text,
          style: {
            ...style,
            wordWrap: false,
            fill: word.active ? s.activeWordColor : s.fill,
          },
        });
        if (
          rowWidth + t.width > text.safeRect.width &&
          required(rows.at(-1)).length
        ) {
          rows.push([]);
          rowWidth = 0;
        }
        required(rows.at(-1)).push(t);
        node.wordTexts.push(t);
        rowWidth += t.width + space;
      }
      let y = 0;
      for (const row of rows) {
        const width =
          row.reduce((n, t) => n + t.width, 0) +
          Math.max(0, row.length - 1) * space;
        let x = -width / 2;
        let height = 0;
        for (const t of row) {
          t.position.set(x, y);
          x += t.width + space;
          height = Math.max(height, t.height);
          block.addChild(t);
        }
        y += height;
      }
    } else {
      const primary = new p.Text({ text: text.content, style });
      block.addChild(primary);
      if (s.secondary && text.secondaryContent) {
        const secondary = new p.Text({
          text: text.secondaryContent,
          style: {
            ...style,
            fontFamily: s.secondary.fontFamily,
            fontSize: s.secondary.fontSize * scale,
            fontWeight: '400',
          },
        });
        secondary.y = primary.height;
        block.addChild(secondary);
      }
    }
    const bounds = block.getLocalBounds();
    const left = s.placement === 'lower-left';
    const x =
      text.anchor.x -
      scene.width / 2 -
      (left ? 0 : bounds.width / 2) -
      bounds.x;
    const y =
      text.anchor.y -
      scene.height / 2 -
      (s.placement === 'center' ? bounds.height / 2 : bounds.height) -
      bounds.y;
    // Pop rows already use centered x coordinates; bounds.x accounts for this.
    block.position.set(x, y);
    if (s.background) {
      const pad = s.background.padding * scale,
        g = new p.Graphics()
          .roundRect(
            x + bounds.x - pad,
            y + bounds.y - pad,
            bounds.width + 2 * pad,
            bounds.height + 2 * pad,
            s.background.radius * scale,
          )
          .fill({ color: s.background.color, alpha: s.background.alpha });
      node.content.addChild(g);
    }
    node.content.addChild(block);
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.revision;
    this.pendingPreparations.forEach((cancel) => cancel());
    this.pendingPreparations.clear();
    for (const id of this.nodes.keys()) this.destroyNode(id);
    for (const id of this.pairs.keys()) this.destroyPair(id);
    // Any zero-reference entry from a failed submit is also reclaimed.
    this.textures.forEach((entry) => {
      entry.texture.destroy(true);
      entry.lease.release?.();
    });
    this.textures.clear();
    this.app?.destroy(
      { removeView: false },
      { children: true, texture: false, textureSource: false },
    );
    this.app = undefined;
    this.root = undefined;
    this.fonts.clear();
  }
}
