import { createResolvedTextLayout, textBlockOrigin } from './text-styles';
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
  ComparisonFrame,
  RendererBranch,
  PreparedRendererResource,
  RendererInit,
  RendererOptions,
  RendererResourceRequest,
  RenderResult,
  RenderOptions,
  SceneRenderer,
} from './renderer-types';
export type {
  PreparedRendererResource,
  RendererInit,
  RendererOptions,
  RendererResourceRequest,
  RenderResult,
} from './renderer-types';

/** Failure-only read-only adapter probe. Does not request a device or create a GL context. */
export async function gpuAvailabilityDiagnostic(
  environment: {
    secureContext: boolean;
    webgl2Api: boolean;
    requestAdapter?: () => Promise<unknown>;
  } = {
    secureContext: globalThis.isSecureContext === true,
    webgl2Api: typeof WebGL2RenderingContext !== 'undefined',
    requestAdapter:
      typeof navigator !== 'undefined' && 'gpu' in navigator
        ? () =>
            (
              navigator as Navigator & {
                gpu: { requestAdapter: () => Promise<unknown> };
              }
            ).gpu.requestAdapter()
        : undefined,
  },
): Promise<Error> {
  let adapter = 'API absent';
  let probeCause: Error | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (environment.requestAdapter) {
    try {
      adapter = await Promise.race([
        environment
          .requestAdapter()
          .then((value) =>
            value
              ? 'available (device not requested)'
              : 'unavailable (null adapter)',
          ),
        new Promise<string>((resolve) => {
          timer = setTimeout(
            () => resolve('probe timed out (availability unknown)'),
            500,
          );
        }),
      ]);
    } catch (reason) {
      adapter = 'probe rejected (availability unknown)';
      // The UI selects/redacts bounded exception strings, never stacks or arbitrary fields.
      if (reason instanceof Error) probeCause = reason;
    } finally {
      clearTimeout(timer);
    }
  }
  return new Error(
    `GPU support: secure context=${environment.secureContext}; WebGPU adapter ${adapter}; WebGL2 API=${environment.webgl2Api ? 'exposed' : 'absent'} (context not probed; renderer initialization causes above are authoritative).`,
    probeCause ? { cause: probeCause } : undefined,
  );
}

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
  fontReady?: boolean;
  wordTexts?: PIXI.Text[];
  pairBlend?: LiveFilter;
}
interface PairNode {
  container: PIXI.Container;
  filter: LiveFilter;
  black: PIXI.Graphics;
  size: string;
}
/** Original scene IDs and resource keys are scoped here, never flattened across cuts. */
interface BranchState {
  root: PIXI.Container;
  nodes: Map<string, LayerNode>;
  pairs: Map<string, PairNode>;
  textures: Map<string, CachedTexture>;
  fonts: Map<string, Promise<boolean>>;
  wrapper?: PIXI.Container;
  background?: PIXI.Graphics;
  mask?: PIXI.Graphics;
}
interface PreparedScene {
  scene: SceneGraph;
  resources: Map<string, Map<string, PreparedRendererResource>>;
  fonts: boolean[];
  pending: boolean;
  approximations: Approximation[];
  warn: (id: string, reason: string) => void;
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
/** Retained scene graph. Explicit render calls submit frames; no internal scheduler. */
export class PixiRenderer implements SceneRenderer {
  private pixi?: Pixi;
  private FilterClass?: typeof LiveFilter;
  private app?: PIXI.Application;
  private root?: PIXI.Container;
  private live?: BranchState;
  private comparison?: Record<RendererBranch, BranchState>;
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
          [preferredError, fallbackError, await gpuAvailabilityDiagnostic()],
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
  private acquire(
    state: BranchState,
    resource: PreparedRendererResource,
  ): CachedTexture {
    const prior = state.textures.get(resource.key);
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
    state.textures.set(resource.key, entry);
    return entry;
  }
  private release(state: BranchState, key: string): void {
    const entry = state.textures.get(key);
    if (!entry) return;
    if (--entry.refs > 0) return;
    entry.texture.destroy(true);
    entry.lease.release?.();
    state.textures.delete(key);
  }
  private destroyNode(state: BranchState, id: string): void {
    const node = state.nodes.get(id);
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
    node.resources.forEach((key) => this.release(state, key));
    state.nodes.delete(id);
  }
  private createNode(state: BranchState, layer: ResolvedLayer): LayerNode {
    const p = required(this.pixi);
    const container = new p.Container({
        label: layer.clipId,
        eventMode: 'none',
      }),
      content = new p.Container(),
      crop = new p.Graphics();
    container.addChild(content, crop);
    state.root.addChild(container);
    const node: LayerNode = {
      kind: layer.kind,
      container,
      content,
      crop,
      resources: new Set(),
      filters: new Map(),
    };
    state.nodes.set(layer.clipId, node);
    return node;
  }
  private async fontReady(
    state: BranchState,
    text: ResolvedText,
  ): Promise<boolean> {
    const load = (css: string, content: string) => {
      const key = `${css}:${content}`;
      let ready = state.fonts.get(key);
      if (!ready) {
        ready = Promise.resolve()
          .then(
            () =>
              this.options.loadFont?.(css, content) ??
              (typeof document !== 'undefined' && document.fonts
                ? document.fonts
                    .load(css, content || ' ')
                    .then(
                      (faces) =>
                        faces.length > 0 &&
                        faces.every((face) => face.status === 'loaded') &&
                        document.fonts.check(css, content || ' '),
                    )
                : false),
          )
          .catch(() => false)
          .then((loaded) => {
            if (!loaded && state.fonts.get(key) === ready)
              state.fonts.delete(key);
            if (loaded) this.pixi?.CanvasTextMetrics.clearMetrics();
            return loaded;
          });
        if (state.fonts.size >= 128) {
          const oldest = state.fonts.keys().next().value;
          if (oldest !== undefined) state.fonts.delete(oldest);
        }
        state.fonts.set(key, ready);
      }
      return ready;
    };
    const s = text.style;
    const primary = load(
      `${s.fontStyle} ${s.fontWeight} ${s.fontSize * text.scale}px "${s.fontFamily}"`,
      text.content,
    );
    const secondary =
      s.secondary && text.secondaryContent
        ? load(
            `normal ${s.secondary.fontWeight} ${s.secondary.fontSize * text.scale}px "${s.secondary.fontFamily}"`,
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
  private createState(root: PIXI.Container): BranchState {
    return {
      root,
      nodes: new Map(),
      pairs: new Map(),
      textures: new Map(),
      fonts: new Map(),
    };
  }
  private destroyState(state: BranchState): void {
    for (const id of state.pairs.keys()) this.destroyPair(state, id);
    for (const id of state.nodes.keys()) this.destroyNode(state, id);
    state.textures.forEach((entry) => {
      entry.texture.destroy(true);
      entry.lease.release?.();
    });
    state.textures.clear();
    state.fonts.clear();
    if (state.wrapper) {
      state.wrapper.mask = null;
      state.wrapper.destroy({
        children: true,
        texture: false,
        textureSource: false,
      });
      state.mask?.destroy();
    }
  }
  private exitComparison(): void {
    if (!this.comparison) return;
    this.destroyState(this.comparison.current);
    this.destroyState(this.comparison.historical);
    this.comparison = undefined;
  }
  private createComparisonBranch(branch: RendererBranch): BranchState {
    const p = required(this.pixi);
    const wrapper = new p.Container({ label: `comparison:${branch}` }),
      root = new p.Container({ label: `composition:${branch}` }),
      background = new p.Graphics({ label: `background:${branch}` }),
      mask = new p.Graphics({ label: `wipe:${branch}` });
    wrapper.addChild(background, root);
    wrapper.mask = mask;
    return { ...this.createState(root), wrapper, background, mask };
  }
  async render(
    scene: SceneGraph,
    options: RenderOptions = {},
  ): Promise<RenderResult> {
    return this.renderFrame(scene, options);
  }
  async renderComparison(
    frame: ComparisonFrame,
    options: RenderOptions = {},
  ): Promise<RenderResult> {
    if (options.capture)
      throw new Error('poster unavailable during comparison');
    if (!Number.isFinite(frame.split) || frame.split < 0 || frame.split > 1)
      throw new Error('invalid comparison split');
    return this.renderFrame(frame.current, options, frame);
  }
  private async prepareScene(
    state: BranchState,
    scene: SceneGraph,
    branch: RendererBranch | undefined,
    register: (release: () => void) => void,
  ): Promise<PreparedScene> {
    if (scene.excludedTextPairs?.length) {
      // Preserve the pair's weights/black plane/order with transparent text, not a missing member.
      const layers = [...scene.layers];
      for (const { layer, index } of scene.excludedTextPairs)
        layers.splice(index, 0, {
          ...layer,
          text: undefined,
          assetId: undefined,
          mask: undefined,
          effects: [],
          opacity: 0,
        });
      scene = { ...scene, layers };
    }
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
            branch,
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
          resource = undefined;
          warn(layer.clipId, 'LUT must be a 512x512 atlas; base preview');
          if (!branch) return;
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
            state.textures.get(resource.key)?.lease.source ??
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
          else {
            if (branch) pending = true;
            warn(layer.clipId, 'LUT asset ID absent');
          }
        }
    }
    let preparedReleased = false;
    const releasePrepared = () => {
      if (preparedReleased) return;
      preparedReleased = true;
      prepared.forEach((resources) => resources.forEach((r) => r.release?.()));
    };
    register(releasePrepared);
    if (pending && this.hasFrame)
      return {
        scene,
        resources: prepared,
        fonts: [],
        pending,
        approximations,
        warn,
      };
    const fontWork = Promise.all(
      scene.layers.map(
        async (l) => !l.text || (await this.fontReady(state, l.text)),
      ),
    );
    const fontResults = await fontWork;
    scene.layers.forEach((l, i) => {
      if (!fontResults[i])
        warn(
          l.clipId,
          branch
            ? 'canvas font unavailable; comparison frame withheld'
            : 'canvas font unavailable; system fallback',
        );
    });
    return {
      scene,
      resources: prepared,
      fonts: fontResults,
      pending,
      approximations,
      warn,
    };
  }
  private commitScene(state: BranchState, preparation: PreparedScene): void {
    const {
      scene,
      resources: prepared,
      fonts: fontResults,
      warn,
    } = preparation;
    state.root.scale.set(
      Math.min(
        this.viewport.width / scene.width,
        this.viewport.height / scene.height,
      ),
    );
    state.root.position.set(
      (this.viewport.width - scene.width * state.root.scale.x) / 2,
      (this.viewport.height - scene.height * state.root.scale.y) / 2,
    );
    const visible = new Set(scene.layers.map((l) => l.clipId));
    for (const id of state.nodes.keys())
      if (!visible.has(id)) this.destroyNode(state, id);
    scene.layers.forEach((layer, layerIndex) => {
      let node = state.nodes.get(layer.clipId);
      if (node && node.kind !== layer.kind) {
        this.destroyNode(state, layer.clipId);
        node = undefined;
      }
      node ??= this.createNode(state, layer);
      if (layer.text) {
        if (node.fontReady === false && fontResults[layerIndex])
          node.contentSignature = undefined;
        node.fontReady = fontResults[layerIndex];
      }

      const resources = required(prepared.get(layer.clipId));
      const next = new Set<string>();
      const slots = new Map<string, PIXI.Texture>();
      for (const [slot, resource] of resources) {
        const entry = this.acquire(state, resource);
        resources.delete(slot);
        slots.set(slot, entry.texture);
        if (!next.has(resource.key)) {
          next.add(resource.key);
          if (!node.resources.has(resource.key)) entry.refs++;
        }
      }
      const old = node.resources;
      node.resources = next;
      this.updateNode(state, node, layer, scene, slots, warn);
      // Release only after sprite/filter references point at the newly prepared textures.
      old.forEach((key) => {
        if (!next.has(key)) this.release(state, key);
      });
    });
    this.compositePairs(state, scene, warn);
  }
  private async renderFrame(
    scene: SceneGraph,
    options: RenderOptions,
    comparison?: ComparisonFrame,
  ): Promise<RenderResult> {
    if (options.signal?.aborted) throw new Error('poster capture aborted');
    if (!this.app || !this.root || this.disposed)
      throw new Error('renderer not initialized');
    this.cancelPending();
    const revision = this.revision;
    // States may be prepared while detached. Do not replace the last display tree
    // until both branches have all resources and fonts, including the first frame.
    if (comparison)
      this.comparison ??= {
        current: this.createComparisonBranch('current'),
        historical: this.createComparisonBranch('historical'),
      };
    else this.live ??= this.createState(this.root);
    const releases: (() => void)[] = [];
    let released = false;
    const releasePrepared = () => {
      if (released) return;
      released = true;
      releases.forEach((release) => release());
      this.pendingPreparations.delete(revision);
    };
    this.pendingPreparations.set(revision, releasePrepared);
    const register = (release: () => void) => {
      if (released) release();
      else releases.push(release);
    };
    try {
      let cancelPreparation = () => {};
      const preparationCancelled = new Promise<undefined>((resolve) => {
        cancelPreparation = () => {
          releasePrepared();
          resolve(undefined);
        };
      });
      this.pendingPreparations.set(revision, cancelPreparation);
      options.signal?.addEventListener('abort', cancelPreparation, {
        once: true,
      });
      let preparations: PreparedScene[] | undefined;
      try {
        const work = comparison
          ? Promise.all([
              this.prepareScene(
                required(this.comparison).current,
                comparison.current,
                'current',
                register,
              ),
              this.prepareScene(
                required(this.comparison).historical,
                comparison.historical,
                'historical',
                register,
              ),
            ])
          : Promise.all([
              this.prepareScene(
                required(this.live),
                scene,
                undefined,
                register,
              ),
            ]);
        preparations = await Promise.race([work, preparationCancelled]);
      } finally {
        options.signal?.removeEventListener('abort', cancelPreparation);
      }
      if (!preparations) {
        if (options.capture)
          throw new Error('poster capture invalidated during font preparation');
        return {
          submitted: false,
          retained: this.hasFrame,
          approximations: comparison
            ? [
                {
                  clipId: '',
                  reason:
                    'comparison preparation invalidated; no new frame submitted',
                },
              ]
            : [],
        };
      }
      const collectApproximations = () =>
        preparations.flatMap((p, index) =>
          comparison
            ? p.approximations.map((a) => ({
                ...a,
                reason: `${index === 0 ? 'current' : 'historical'}: ${a.reason}`,
              }))
            : p.approximations,
        );
      let approximations = collectApproximations();
      if (
        this.disposed ||
        revision !== this.revision ||
        options.signal?.aborted
      ) {
        if (options.capture)
          throw new Error('poster capture invalidated during font preparation');
        return { submitted: false, retained: this.hasFrame, approximations };
      }
      const pending = preparations.some((p) => p.pending);
      const fontsMissing = preparations.some((p) =>
        p.fonts.some((ready) => !ready),
      );
      if (options.capture && (pending || fontsMissing))
        throw new Error('poster unavailable: resources or fonts not ready');
      if (
        (comparison && (pending || fontsMissing)) ||
        (pending && this.hasFrame)
      )
        return { submitted: false, retained: this.hasFrame, approximations };
      if (comparison) {
        if (this.live) this.destroyState(this.live);
        this.live = undefined;
        this.root.scale.set(1);
        this.root.position.set(0, 0);
        const states = [
          required(this.comparison).current,
          required(this.comparison).historical,
        ];
        for (const state of states)
          this.root.addChild(required(state.wrapper), required(state.mask));
        preparations.forEach((preparation, index) => {
          const state = required(states[index]);
          this.commitScene(state, preparation);
          const [r, g, b, alpha] = preparation.scene.background ?? [0, 0, 0, 1];
          required(state.background)
            .clear()
            .rect(0, 0, this.viewport.width, this.viewport.height)
            .fill({ color: [r, g, b], alpha });
          const boundary = comparison.split * this.viewport.width;
          required(state.mask)
            .clear()
            .rect(
              index === 0 ? 0 : boundary,
              0,
              index === 0 ? boundary : this.viewport.width - boundary,
              this.viewport.height,
            )
            .fill(0xffffff);
        });
        // Each branch owns its clear plane, including alpha. The shared stage
        // must not turn transparent project backgrounds into opaque black.
        this.app.renderer.background.color = 0;
        this.app.renderer.background.alpha = 0;
      } else {
        this.exitComparison();
        this.commitScene(required(this.live), required(preparations[0]));
        const [r, g, b, alpha] = scene.background ?? [0, 0, 0, 1];
        this.app.renderer.background.color = [r, g, b];
        this.app.renderer.background.alpha = alpha;
      }
      approximations = collectApproximations();
      this.app.render();
      this.hasFrame = true;
      if (!options.capture)
        return { submitted: true, retained: false, approximations };
      // Readback is taken from this exact prepared tree before releasing its leases.
      // Pixi uses this renderer's device, not another Application/context/ticker.
      const scale = Math.min(
        this.viewport.width / scene.width,
        this.viewport.height / scene.height,
      );
      const canvas = this.app.renderer.extract.canvas({
        target: this.root,
        frame: new (required(this.pixi).Rectangle)(
          0,
          0,
          scene.width,
          scene.height,
        ),
        resolution: scale,
        clearColor: scene.background ?? [0, 0, 0, 1],
      });
      const width = canvas.width,
        height = canvas.height;
      // Encoding is asynchronous. Invalidation must release the existing loop
      // promptly rather than leave playback waiting on an abandoned callback.
      let cancelReadback = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => {
        cancelReadback = () => reject(new Error('poster capture invalidated'));
      });
      this.pendingPreparations.set(revision, () => {
        releasePrepared();
        cancelReadback();
      });
      options.signal?.addEventListener('abort', cancelReadback, { once: true });
      const encode = async (): Promise<Blob> =>
        canvas.convertToBlob
          ? canvas.convertToBlob({ type: 'image/png' })
          : new Promise<Blob>((resolve, reject) => {
              if (!canvas.toBlob)
                return reject(new Error('poster encoding unavailable'));
              canvas.toBlob(
                (value) =>
                  value
                    ? resolve(value)
                    : reject(new Error('poster readback failed')),
                'image/png',
              );
            });
      let blob: Blob;
      try {
        blob = await Promise.race([encode(), cancelled]);
      } finally {
        options.signal?.removeEventListener('abort', cancelReadback);
      }
      if (
        this.disposed ||
        revision !== this.revision ||
        options.signal?.aborted
      )
        throw new Error('poster capture invalidated');
      if (!blob.size || blob.type !== 'image/png' || width <= 0 || height <= 0)
        throw new Error('poster readback unavailable');
      return {
        submitted: true,
        retained: false,
        approximations,
        frame: { blob, width, height },
      };
    } finally {
      releasePrepared();
    }
  }
  private destroyPair(state: BranchState, id: string): void {
    const pair = state.pairs.get(id);
    if (!pair) return;
    for (const node of state.nodes.values())
      if (node.container.parent === pair.container)
        state.root.addChild(node.container);
    pair.container.filters = [];
    pair.filter.destroy();
    pair.black.destroy();
    pair.container.destroy({ children: false });
    state.pairs.delete(id);
  }
  private compositePairs(
    state: BranchState,
    scene: SceneGraph,
    warn: (id: string, reason: string) => void,
  ): void {
    const pairs: ResolvedTransitionPair[] = [];
    const byClip = new Map<string, ResolvedTransitionPair>();
    for (const pair of scene.transitionPairs ?? []) {
      if (
        !state.nodes.has(pair.outgoingClipId) ||
        !state.nodes.has(pair.incomingClipId) ||
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
    for (const id of state.pairs.keys())
      if (!active.has(id)) this.destroyPair(state, id);
    for (const [id, node] of state.nodes)
      if (!byClip.has(id) && node.pairBlend) {
        node.container.filters = [];
        node.pairBlend.destroy();
        node.pairBlend = undefined;
      }
    const p = required(this.pixi);
    for (const descriptor of pairs) {
      let pair = state.pairs.get(descriptor.id);
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
        state.root.addChild(container);
        pair = { container, black, filter, size: '' };
        state.pairs.set(descriptor.id, pair);
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
      const outgoing = required(state.nodes.get(descriptor.outgoingClipId)),
        incoming = required(state.nodes.get(descriptor.incomingClipId));
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
        ? required(state.pairs.get(pair.id)).container
        : required(state.nodes.get(layer.clipId)).container;
      if (display.parent !== state.root) state.root.addChild(display);
      state.root.setChildIndex(display, index++);
    }
  }
  private updateNode(
    state: BranchState,
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
        state.root.scale.x,
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
    const layout = createResolvedTextLayout(p, text);
    const block = layout.block;
    node.wordTexts = layout.words;
    const bounds = block.getLocalBounds();
    const origin = textBlockOrigin(text, scene, bounds);
    const x = origin.x - bounds.x,
      y = origin.y - bounds.y;
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
    this.exitComparison();
    if (this.live) this.destroyState(this.live);
    this.live = undefined;
    this.app?.destroy(
      { removeView: false },
      { children: true, texture: false, textureSource: false },
    );
    this.app = undefined;
    this.root = undefined;
  }
}
