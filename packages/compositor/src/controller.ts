import type {
  Asset,
  KimoProject,
  ServerEvent,
  MaskRleFrame,
} from '@kimo/client';
import { TimelineClock } from './clock';
import { MediaPool } from './media-pool';
import {
  AudioEngine,
  audioCapabilities,
  type AudioLevels,
  type AudioCapabilities,
} from './audio-engine';
import {
  FilmstripService,
  FilmstripWorkerEncoder,
  type FilmstripCache,
  type TimestampedFrame,
} from './filmstrip';
import { buildScene } from './scene-builder';
import type { MediaFrame, VideoRequest } from './media-types';
import type {
  SceneRenderer,
  PreparedRendererResource,
  RendererResourceRequest,
} from './renderer-types';
import type { SceneGraph } from './types';

function readRleFrame(value: unknown): MaskRleFrame {
  if (
    !value ||
    typeof value !== 'object' ||
    !('frameIndex' in value) ||
    !('width' in value) ||
    !('height' in value) ||
    !('counts' in value) ||
    typeof value.frameIndex !== 'number' ||
    !Number.isSafeInteger(value.frameIndex) ||
    value.frameIndex < 0 ||
    typeof value.width !== 'number' ||
    typeof value.height !== 'number' ||
    !Array.isArray(value.counts) ||
    !value.counts.every((count: unknown) => typeof count === 'number')
  )
    throw new Error('invalid RLE frame contract');
  return {
    frameIndex: value.frameIndex,
    width: value.width,
    height: value.height,
    counts: value.counts as number[],
  };
}
export interface TransportState {
  playing: boolean;
  speed: number;
  volume: number;
  loop: boolean;
  inPoint: number | null;
  outPoint: number | null;
  scrubbing: boolean;
  scrubAudioEnabled: boolean;
  followKimo: boolean;
  shuttle: number;
}
export interface ControllerMetrics {
  submittedFps: number | null;
  presentedFps: number | null;
  ingressToPrepareMs: number | null;
  ingressToSubmitMs: number | null;
  width: number;
  height: number;
  quality: '1080' | '720';
  issues: string[];
  revision: number;
  submittedRevision: number;
}
export interface ActionOverlay {
  actionId: string;
  target?: Extract<ServerEvent, { t: 'agent.action.start' }>['target'];
  mask?: Extract<ServerEvent, { t: 'sam.mask' }>;
  ended: boolean;
}
/** Structural, type-only bridge seam. No second controller/renderer is required. */
export interface ControllerPreviewAPI {
  readonly currentScene: SceneGraph | null;
  setEditingTextClip(clipId: string | null): void;
  getAudioLevel(): AudioLevels;
  getAudioCapabilities(clipId: string): AudioCapabilities;
  getCompareCapability(): { available: false; reason: string };
}
export interface ControllerOptions {
  project: KimoProject;
  assets?: readonly Asset[];
  renderer: SceneRenderer;
  pool?: MediaPool;
  audio?: AudioEngine;
  warmup?: Map<string, HTMLVideoElement>;
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  hardwareConcurrency?: number;
  reducedMotion?: boolean;
  onReducedFollow?: () => void;
  filmstripCache?: FilmstripCache;
  onPlayback?: (time: number, playing: boolean, fps: number | null) => void;
  onMetrics?: (metrics: ControllerMetrics) => void;
  onOverlay?: (overlay: ActionOverlay | null) => void;
  onEditAt?: (target: { actionId: string; time: number } | null) => void;
  onScene?: (scene: SceneGraph) => void;
}
export function previewSize(
  project: Pick<KimoProject, 'width' | 'height'>,
  width: number,
  height: number,
  low: boolean,
) {
  const portrait = project.height > project.width;
  const capW = portrait ? (low ? 720 : 1080) : low ? 1280 : 1920;
  const capH = portrait ? (low ? 1280 : 1920) : low ? 720 : 1080;
  const scale = Math.min(
    Math.max(1, width) / project.width,
    Math.max(1, height) / project.height,
    capW / project.width,
    capH / project.height,
  );
  return {
    width: Math.max(1, Math.floor(project.width * scale)),
    height: Math.max(1, Math.floor(project.height * scale)),
  };
}
/** Semantic comparison is necessary: applyOps clones all clips, including untouched ones. */
export function affectedClipIds(
  before: KimoProject | null,
  after: KimoProject,
): Set<string> {
  if (
    !before ||
    before.id !== after.id ||
    before.width !== after.width ||
    before.height !== after.height ||
    JSON.stringify(before.tracks) !== JSON.stringify(after.tracks)
  )
    return new Set([
      ...Object.keys(before?.clips ?? {}),
      ...Object.keys(after.clips),
    ]);
  return new Set(
    [...Object.keys(before.clips), ...Object.keys(after.clips)].filter(
      (id) =>
        JSON.stringify(before.clips[id]) !== JSON.stringify(after.clips[id]),
    ),
  );
}
const initialTransport: TransportState = {
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
/** Sole animation-loop owner. React receives transport/telemetry at most ten times per second. */
export class CompositorController implements ControllerPreviewAPI {
  private project: KimoProject;
  private assets: Record<string, Asset> = {};
  private readonly renderer: ControllerOptions['renderer'];
  readonly pool: MediaPool;
  private readonly audio: AudioEngine;
  private readonly clock: TimelineClock;
  private readonly now: () => number;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (id: number) => void;
  private transport = initialTransport;
  private revision = 0;
  private dirty = true;
  readonly dirtyClipIds = new Set<string>();
  private disposed = false;
  private ready = false;
  private editingTextClip: string | null = null;
  private publishedScene: SceneGraph | null = null;
  private raf: number | null = null;
  private preparing = false;
  private renderInFlight = false;
  private ingress: number | null = null;
  private frames = new Map<string, MediaFrame>();
  private images = new Map<string, ImageBitmap>();
  private imagePins = new Map<
    string,
    { release: () => void; refs: number; owned: boolean }
  >();
  private imageLoads = new Map<string, Promise<void>>();
  private audioLoads = new Map<string, Promise<void>>();
  private viewport = { width: 1920, height: 1080 };
  private low: boolean;
  private lastPublish = -Infinity;
  private publicationPending = false;
  private measureStart = 0;
  private submissions = 0;
  private lowSince: number | null = null;
  private follow: {
    actionId: string;
    from: number;
    to: number;
    started: number;
  } | null = null;
  private overlay: ActionOverlay | null = null;
  private readonly seenActions = new Set<string>();
  private readonly pendingMasks = new Map<
    string,
    Extract<ServerEvent, { t: 'sam.mask' }>
  >();
  private readonly rle = new Map<
    string,
    Map<number, PreparedRendererResource>
  >();
  private readonly rleLoads = new Map<string, AbortController>();
  private readonly imageAppearance = new Map<string, number>();
  private videoMonitor: { element: HTMLVideoElement; id: number } | null = null;
  private videoPresentations = 0;
  private measuredVideo = false;
  private lastScrub: number | null = null;
  private readonly resourceIds = new WeakMap<object, number>();
  private resourceId = 0;
  private filmstrip?: FilmstripService;
  private filmstripEncoder?: FilmstripWorkerEncoder;
  private metrics: ControllerMetrics;
  constructor(private readonly options: ControllerOptions) {
    this.project = options.project;
    this.renderer = options.renderer;
    this.pool = options.pool ?? new MediaPool();
    this.audio =
      options.audio ??
      new AudioEngine({ onIssue: (message) => this.issue(message) });
    this.now = options.now ?? (() => performance.now());
    this.requestFrame =
      options.requestFrame ?? ((cb) => requestAnimationFrame(cb));
    this.cancelFrame =
      options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
    this.low = (options.hardwareConcurrency ?? 8) <= 4;
    this.clock = new TimelineClock({
      now: this.now,
      audioTime: () => this.audio.audioTime(),
      duration: this.project.duration,
    });
    this.metrics = {
      submittedFps: null,
      presentedFps: null,
      ingressToPrepareMs: null,
      ingressToSubmitMs: null,
      width: 0,
      height: 0,
      quality: this.low ? '720' : '1080',
      issues: [],
      revision: 0,
      submittedRevision: -1,
    };
    if (options.warmup) this.pool.adoptWarmup(options.warmup);
    this.setAssets(options.assets ?? []);
  }
  async init(canvas: HTMLCanvasElement): Promise<void> {
    const size = previewSize(
      this.project,
      this.viewport.width,
      this.viewport.height,
      this.low,
    );
    await this.renderer.init({ canvas, ...size, resolution: 1 });
    if (this.disposed) {
      this.renderer.destroy();
      return;
    }
    this.ready = true;
    this.measureStart = this.now();
    this.resize(this.viewport.width, this.viewport.height);
    this.schedule();
  }
  private getFilmstripService(): FilmstripService {
    if (this.disposed) throw new Error('Compositor disposed');
    if (!this.filmstrip) {
      const canWorker = typeof globalThis.Worker !== 'undefined';
      if (canWorker) this.filmstripEncoder = new FilmstripWorkerEncoder();
      else
        this.issue(
          'filmstrip worker unavailable; main-thread resize approximation',
        );
      this.filmstrip = new FilmstripService({
        pool: this.pool,
        cache: this.options.filmstripCache,
        encode: this.filmstripEncoder?.encode.bind(this.filmstripEncoder),
        decodeAudio: (asset) => this.audio.loadBuffer(asset),
        onIssue: (message) => this.issue(message),
      });
    }
    return this.filmstrip;
  }
  private filmstripClip(clipId: string) {
    const clip = this.project.clips[clipId],
      asset = clip?.assetId ? this.assets[clip.assetId] : undefined;
    if (!clip || !asset) throw new Error('Filmstrip clip asset unavailable');
    return { ...clip, asset };
  }
  getFilmstrip(
    clipId: string,
    widthPx: number,
    signal?: AbortSignal,
  ): Promise<readonly TimestampedFrame[]> {
    return this.getFilmstripService().getFilmstrip(
      this.filmstripClip(clipId),
      widthPx,
      signal,
    );
  }
  getWaveform(
    clipId: string,
    points: number,
    signal?: AbortSignal,
  ): Promise<Float32Array> {
    return this.getFilmstripService().getWaveform(
      this.filmstripClip(clipId),
      points,
      signal,
    );
  }
  get currentTime(): number {
    return this.clock.currentTime;
  }
  get debug(): ControllerMetrics {
    return { ...this.metrics, issues: [...this.metrics.issues] };
  }
  /** Last coherently submitted unfiltered scene, retained while a text visual is hidden. */
  get currentScene(): SceneGraph | null {
    return this.publishedScene;
  }
  getAudioLevel(): AudioLevels {
    return this.audio.getLevels();
  }
  getAudioCapabilities(clipId: string): AudioCapabilities {
    return audioCapabilities(this.project.clips[clipId]?.kind ?? 'unknown');
  }
  getCompareCapability(): { available: false; reason: string } {
    return {
      available: false,
      reason: 'Isolated before/after grade composition is not implemented',
    };
  }
  /** Preview-only suppression; published scene remains measurable and no op is produced. */
  setEditingTextClip(clipId: string | null): void {
    if (this.disposed || clipId === this.editingTextClip) return;
    this.editingTextClip = clipId;
    this.invalidate();
  }
  markIngress(): void {
    this.ingress = this.now();
  }
  private issue(message: string): void {
    if (!this.metrics || this.disposed) return;
    if (!this.metrics.issues.includes(message))
      this.metrics.issues = [...this.metrics.issues.slice(-15), message];
    this.schedule();
  }
  private invalidate(): void {
    if (this.ready) this.renderer.cancelPending?.();
    if (this.renderInFlight && !this.renderer.cancelPending)
      this.issue(
        'renderer cancellation hook unavailable; stale async submission cannot be excluded',
      );
    this.revision++;
    this.metrics.revision = this.revision;
    this.dirty = true;
    this.schedule();
  }
  updateProject(
    project: KimoProject,
    ids = affectedClipIds(this.project, project),
  ): void {
    if (this.disposed) return;
    this.project = project;
    ids.forEach((id) => this.dirtyClipIds.add(id));
    this.clock.setDuration(project.duration);
    this.configureLoop();
    this.invalidate();
  }
  setAssets(assets: readonly Asset[]): void {
    if (this.disposed) return;
    const next = Object.fromEntries(assets.map((asset) => [asset.id, asset]));
    if (JSON.stringify(next) === JSON.stringify(this.assets)) return;
    for (const [id, previous] of Object.entries(this.assets))
      if (JSON.stringify(previous) !== JSON.stringify(next[id])) {
        this.unpinImage(id);
        this.images.delete(id);
        this.imageLoads.delete(id);
        this.audioLoads.delete(id);
        this.rleLoads.get(id)?.abort();
        this.rleLoads.delete(id);
        this.rle.delete(id);
        this.imageAppearance.delete(id);
      }
    this.assets = next;
    for (const asset of assets) {
      if (asset.mask?.encoding === 'rle' && !this.rleLoads.has(asset.id))
        void this.loadRle(asset);
      if (
        asset.kind === 'image' &&
        asset.mask?.encoding !== 'rle' &&
        !this.imageLoads.has(asset.id)
      ) {
        const identity = asset;
        const promise = this.pool
          .acquireImage(asset)
          .then((lease) => {
            if (
              !this.disposed &&
              this.assets[asset.id]?.url === identity.url &&
              this.assets[asset.id]?.proxyUrl === identity.proxyUrl
            ) {
              this.images.set(asset.id, lease.bitmap);
              this.imagePins.set(asset.id, {
                release: lease.release,
                refs: 0,
                owned: true,
              });
              this.invalidate();
            } else lease.release();
          })
          .catch((error) => this.issue(String(error)));
        this.imageLoads.set(asset.id, promise);
      }
      if (asset.kind === 'audio' && !this.audioLoads.has(asset.id)) {
        this.audioLoads.set(
          asset.id,
          this.audio
            .loadBuffer(asset)
            .then(() => {
              if (!this.disposed) this.invalidate();
            })
            .catch((error) => this.issue(String(error))),
        );
      }
    }
    this.invalidate();
  }
  private unpinImage(id: string): void {
    const pin = this.imagePins.get(id);
    if (!pin) return;
    pin.owned = false;
    this.imagePins.delete(id);
    if (pin.refs === 0) pin.release();
  }
  private async loadRle(asset: Asset): Promise<void> {
    if (asset.mask?.encoding !== 'rle') return;
    const metadata = asset.mask,
      abort = new AbortController();
    this.rleLoads.set(asset.id, abort);
    const timeout = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await fetch(metadata.payloadUrl, {
        signal: abort.signal,
      });
      if (!response.ok)
        throw new Error(`mask payload failed: ${response.status}`);
      const payload: unknown = await response.json();
      const frames = Array.isArray(payload)
        ? payload
        : payload &&
            typeof payload === 'object' &&
            'frames' in payload &&
            Array.isArray(payload.frames)
          ? payload.frames
          : [];
      if (!frames.length || frames.length > 300)
        throw new Error(
          'RLE payload has no frames or exceeds 300-frame budget',
        );
      const { decodeRLE } = await import('./filters');
      const resources = new Map<number, PreparedRendererResource>();
      let bytes = 0;
      for (const value of frames) {
        const frame = readRleFrame(value);
        bytes += frame.width * frame.height * 4;
        if (
          frame.width !== metadata.width ||
          frame.height !== metadata.height ||
          bytes > 64 * 1024 * 1024
        )
          throw new Error(
            'RLE metadata mismatch or decoded memory budget exceeded',
          );
        resources.set(frame.frameIndex, {
          key: `rle:${asset.id}:${metadata.payloadUrl}:${frame.frameIndex}`,
          source: {
            data: decodeRLE(frame.width, frame.height, frame.counts),
            width: frame.width,
            height: frame.height,
          },
          width: frame.width,
          height: frame.height,
        });
      }
      const currentMetadata = this.assets[asset.id]?.mask;
      if (
        !this.disposed &&
        !abort.signal.aborted &&
        currentMetadata?.encoding === 'rle' &&
        currentMetadata.payloadUrl === metadata.payloadUrl
      ) {
        this.rle.set(asset.id, resources);
        this.invalidate();
      }
    } catch (error) {
      if (!this.disposed && !abort.signal.aborted) this.issue(String(error));
    } finally {
      clearTimeout(timeout);
    }
  }
  private configureLoop(): void {
    try {
      this.clock.setLoop(
        this.transport.loop,
        this.transport.inPoint,
        this.transport.outPoint,
      );
    } catch (error) {
      this.clock.setLoop(false);
      this.issue(String(error));
    }
  }
  setTransport(next: TransportState, seek?: number): void {
    if (this.disposed) return;
    const previous = this.transport;
    this.transport = { ...next };
    if (seek !== undefined) {
      this.follow = null;
      this.options.onEditAt?.(null);
      this.clock.seek(seek);
    }
    if (next.playing || next.scrubbing || !next.followKimo) this.follow = null;
    this.clock.setRate(next.speed);
    this.configureLoop();
    this.clock.setAudioActive(
      next.volume > 0 &&
        Object.values(this.project.clips).some(
          (clip) => clip.kind === 'audio' || clip.kind === 'video',
        ),
    );
    if (next.playing && next.shuttle >= 0) {
      this.clock.play();
      if (!previous.playing)
        void this.audio
          .resume()
          .then((ok) => {
            if (!this.disposed && !ok)
              this.issue('audio unavailable; silent preview');
          })
          .catch((error) => this.issue(String(error)));
    } else {
      this.clock.pause();
      this.audio.pause();
    }
    if (next.shuttle < 0)
      this.issue(
        'reverse shuttle unavailable; preview paused (no forward substitution)',
      );
    if (next.scrubbing && !previous.scrubbing) {
      const revision = this.revision + 1;
      void this.audio
        .resume()
        .then((ok) => {
          if (
            ok &&
            !this.disposed &&
            this.transport.scrubbing &&
            revision === this.revision
          )
            this.audio.scrub(
              Object.values(this.project.clips),
              this.project.tracks,
              this.clock.currentTime,
              this.transport.scrubAudioEnabled,
            );
        })
        .catch((error) => this.issue(String(error)));
    }
    if (next.scrubbing && seek !== undefined && seek !== this.lastScrub) {
      this.lastScrub = seek;
      this.audio.scrub(
        Object.values(this.project.clips),
        this.project.tracks,
        seek,
        next.scrubAudioEnabled,
      );
    }
    if (!next.scrubbing) this.lastScrub = null;
    this.invalidate();
  }
  seek(time: number): void {
    this.follow = null;
    this.clock.seek(time);
    this.invalidate();
    this.publish(true);
  }
  event(event: ServerEvent): void {
    if (this.disposed) return;
    if (event.t === 'project.ops') this.markIngress();
    if (event.t === 'asset.added')
      this.setAssets([
        ...Object.values(this.assets).filter(
          (asset) => asset.id !== event.asset.id,
        ),
        event.asset,
      ]);
    if (event.t === 'agent.action.start') {
      if (this.seenActions.has(event.id)) return;
      this.seenActions.add(event.id);
      if (this.seenActions.size > 512)
        this.seenActions.delete(this.seenActions.keys().next().value ?? '');
      this.options.onEditAt?.(null);
      this.overlay = {
        actionId: event.id,
        target: event.target,
        mask: this.pendingMasks.get(event.id),
        ended: false,
      };
      this.options.onOverlay?.(this.overlay);
      const target =
        event.target?.time ??
        (event.target?.clipId
          ? this.project.clips[event.target.clipId]?.start
          : undefined);
      this.follow = null;
      if (target !== undefined && this.transport.followKimo) {
        const time = Math.min(this.project.duration, Math.max(0, target));
        if (this.transport.playing)
          this.options.onEditAt?.({ actionId: event.id, time });
        else if (!this.transport.scrubbing) {
          if (this.options.reducedMotion) {
            this.options.onReducedFollow?.();
            this.seek(time);
          } else {
            this.follow = {
              actionId: event.id,
              from: this.clock.currentTime,
              to: time,
              started: this.now(),
            };
            this.schedule();
          }
        }
      }
    }
    if (event.t === 'agent.action.end') {
      if (this.follow?.actionId === event.id) this.follow = null;
      if (this.overlay?.actionId === event.id) {
        this.overlay = { ...this.overlay, ended: true };
        this.options.onOverlay?.(this.overlay);
        this.options.onEditAt?.(null);
      }
    }
    if (event.t === 'sam.mask' && !event.actionId)
      this.issue(
        'SAM overlay action ID unavailable; no unverified correlation or subject label',
      );
    if (event.t === 'sam.mask' && event.actionId) {
      this.pendingMasks.set(event.actionId, event);
      if (this.pendingMasks.size > 32)
        this.pendingMasks.delete(this.pendingMasks.keys().next().value ?? '');
      if (this.overlay?.actionId === event.actionId) {
        this.overlay = { ...this.overlay, mask: event };
        this.options.onOverlay?.(this.overlay);
      }
    }
  }
  resize(width: number, height: number): void {
    this.viewport = { width, height };
    const size = previewSize(this.project, width, height, this.low);
    this.metrics = {
      ...this.metrics,
      ...size,
      quality: this.low ? '720' : '1080',
    };
    if (this.ready && !this.disposed)
      this.renderer.resize(size.width, size.height, 1);
    this.invalidate();
  }
  getResource = (
    request: RendererResourceRequest,
  ): PreparedRendererResource | undefined => {
    if (this.disposed) return;
    if (request.role === 'mask') {
      const metadata = this.assets[request.assetId]?.mask;
      if (metadata?.encoding === 'rle') {
        const index =
          request.frameIndex ??
          Math.floor(
            (request.sourceTime - (metadata.timeOrigin ?? 0)) * metadata.fps,
          );
        return this.rle.get(request.assetId)?.get(index);
      }
    }
    const frame = this.frames.get(
      request.role === 'mask' ? `${request.clipId}:mask` : request.clipId,
    );
    if (frame && request.role !== 'lut') {
      let id = this.resourceIds.get(frame.element);
      if (!id) {
        id = ++this.resourceId;
        this.resourceIds.set(frame.element, id);
      }
      return {
        key: `video:${id}`,
        source: frame.element,
        width: frame.element.videoWidth,
        height: frame.element.videoHeight,
        approximation: frame.exact
          ? undefined
          : (frame.reason ?? 'decoded frame timing not exact'),
      };
    }
    const bitmap = this.images.get(request.assetId);
    if (bitmap) {
      const pin = this.imagePins.get(request.assetId);
      if (!pin) return;
      pin.refs++;
      let released = false;
      let id = this.resourceIds.get(bitmap);
      if (!id) {
        id = ++this.resourceId;
        this.resourceIds.set(bitmap, id);
      }
      return {
        key: `image:${request.assetId}:${id}`,
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => {
          if (released) return;
          released = true;
          pin.refs--;
          if (!pin.owned && pin.refs === 0) pin.release();
        },
      };
    }
  };
  private hasResource(request: RendererResourceRequest): boolean {
    const resource = this.getResource(request);
    resource?.release?.();
    return !!resource;
  }
  private schedule(): void {
    if (this.ready && !this.disposed && this.raf === null)
      this.raf = this.requestFrame(this.tick);
  }
  private tick = (): void => {
    this.raf = null;
    if (this.disposed) return;
    if (this.follow) {
      const progress = Math.min(1, (this.now() - this.follow.started) / 240);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.clock.seek(
        this.follow.from + (this.follow.to - this.follow.from) * eased,
      );
      this.invalidate();
      if (progress === 1) this.follow = null;
    }
    if ((this.dirty || this.clock.playing) && !this.preparing)
      void this.prepare();
    this.publish();
    if (
      this.clock.playing ||
      this.follow ||
      this.dirty ||
      this.publicationPending
    )
      this.schedule();
  };
  private async prepare(): Promise<void> {
    this.preparing = true;
    this.dirty = false;
    const revision = this.revision;
    const project = this.project;
    const assets = this.assets;
    const time = this.clock.currentTime;
    const ingress = this.ingress;
    const current = () => !this.disposed && revision === this.revision;
    try {
      const scene = buildScene(project, time, {
        assets,
        masterVolume: this.transport.volume,
      });
      let fading = false;
      for (const layer of scene.layers)
        if (
          layer.kind === 'image' &&
          layer.assetId &&
          assets[layer.assetId]?.source === 'web' &&
          this.images.has(layer.assetId)
        ) {
          const started = this.imageAppearance.get(layer.assetId) ?? this.now();
          this.imageAppearance.set(layer.assetId, started);
          const progress = Math.min(1, (this.now() - started) / 120);
          layer.opacity *= progress;
          if (progress < 1) fading = true;
        }
      const requests: VideoRequest[] = [];
      const visible = new Set(scene.layers.map((layer) => layer.clipId));
      for (const layer of scene.layers) {
        const clip = project.clips[layer.clipId];
        if (!clip) continue;
        const asset = layer.assetId ? assets[layer.assetId] : undefined;
        // Resolved transition handles/boundary samples must not be re-filtered by raw clip visibility.
        if (asset?.kind === 'video')
          requests.push({
            clipId: clip.id,
            asset,
            start: time,
            duration: 1 / project.fps,
            in: layer.sourceTime,
            speed: clip.speed,
            purpose: 'video',
            sourceTiming: {
              timelineTime: time,
              mediaTime: layer.sourceTime,
              rate:
                layer.transitionSample?.mode === 'boundary' ? 0 : clip.speed,
            },
          });
        const mask = layer.mask ? assets[layer.mask.assetId] : undefined;
        if (mask?.kind === 'video')
          requests.push({
            clipId: `${clip.id}:mask`,
            asset: mask,
            start: time,
            duration: 1 / project.fps,
            in: layer.mask?.sourceTime ?? layer.sourceTime,
            speed: clip.speed,
            purpose: 'mask',
            sourceTiming: {
              timelineTime: time,
              mediaTime: Math.max(
                0,
                (layer.mask?.sourceTime ?? layer.sourceTime) -
                  (layer.mask?.metadata?.timeOrigin ?? 0),
              ),
              rate:
                layer.transitionSample?.mode === 'boundary' ? 0 : clip.speed,
            },
          });
      }
      if (this.clock.playing)
        for (const clip of Object.values(project.clips)) {
          if (
            visible.has(clip.id) ||
            clip.start <= time ||
            clip.start > time + 1.5 ||
            project.tracks.find((track) => track.id === clip.trackId)?.hidden
          )
            continue;
          const asset = clip.assetId ? assets[clip.assetId] : undefined;
          if (asset?.kind === 'video')
            requests.push({
              ...clip,
              clipId: clip.id,
              asset,
              purpose: 'video',
            });
        }
      const result = await this.pool.sync(requests, {
        time,
        playing: this.clock.playing,
        rate: this.transport.speed,
        fps: project.fps,
        fast: this.transport.scrubbing,
      });
      if (!current()) return;
      this.frames = result.frames;
      this.monitorVideo(
        [...result.frames].find(([id]) => !id.endsWith(':mask'))?.[1]?.element,
      );
      result.issues.forEach((message) => this.issue(message));
      if (ingress !== null)
        this.metrics.ingressToPrepareMs = this.now() - ingress;
      const elements = new Map(
        [...result.frames]
          .filter(([id]) => !id.endsWith(':mask'))
          .map(([id, frame]) => [id, frame.element]),
      );
      this.audio.sync(
        Object.values(project.clips),
        project.tracks,
        time,
        {
          playing: this.clock.playing,
          rate: this.transport.speed,
          master: this.transport.volume,
          epoch: this.clock.loopRevision,
        },
        elements,
      );
      if (!current()) return;
      this.renderInFlight = true;
      const hidden = this.editingTextClip;
      const renderScene = hidden
        ? {
            ...scene,
            layers: scene.layers.filter(
              (layer) => !(layer.clipId === hidden && layer.kind === 'text'),
            ),
            excludedTextPairs: scene.layers.flatMap((layer, index) =>
              layer.clipId === hidden &&
              layer.kind === 'text' &&
              layer.transitionPairId
                ? [
                    {
                      layer: {
                        ...layer,
                        text: undefined,
                        assetId: undefined,
                        mask: undefined,
                        effects: [],
                        opacity: 0,
                        approximations: [],
                      },
                      index,
                    },
                  ]
                : [],
            ),
          }
        : scene;
      const rendered = await this.renderer.render(renderScene);
      this.renderInFlight = false;
      if (!current()) return;
      rendered.approximations.forEach((value) => this.issue(value.reason));
      if (rendered.submitted) {
        this.submissions++;
        this.metrics.submittedRevision = revision;
        this.dirtyClipIds.clear();
        if (ingress !== null) {
          this.metrics.ingressToSubmitMs = this.now() - ingress;
          this.ingress = null;
        }
        if (
          scene.layers.every(
            (layer) =>
              (!layer.assetId ||
                !['video', 'image'].includes(layer.kind) ||
                this.hasResource({
                  clipId: layer.clipId,
                  assetId: layer.assetId,
                  sourceTime: layer.sourceTime,
                  role: 'media',
                })) &&
              (!layer.mask ||
                this.hasResource({
                  clipId: layer.clipId,
                  assetId: layer.mask.assetId,
                  sourceTime: layer.mask.sourceTime,
                  role: 'mask',
                })),
          )
        ) {
          this.publishedScene = scene;
          this.options.onScene?.(scene);
        }
      }
      if (rendered.retained)
        this.issue('retaining last good frame while resources prepare');
      if (fading) {
        this.dirty = true;
      }
      // presentedFps is video rVFC evidence only, never composite GPU presentation.
    } catch (error) {
      if (current())
        this.issue(error instanceof Error ? error.message : String(error));
    } finally {
      this.renderInFlight = false;
      this.preparing = false;
      if (!this.disposed && (this.dirty || this.clock.playing || this.follow))
        this.schedule();
      this.publish();
    }
  }
  private monitorVideo(element: HTMLVideoElement | undefined): void {
    if (this.videoMonitor?.element === element) return;
    if (this.videoMonitor)
      this.videoMonitor.element.cancelVideoFrameCallback(this.videoMonitor.id);
    this.videoMonitor = null;
    this.measuredVideo = false;
    if (!element?.requestVideoFrameCallback) return;
    this.measuredVideo = true;
    let previous: number | undefined;
    const presented: VideoFrameRequestCallback = (_now, metadata) => {
      if (this.disposed || this.videoMonitor?.element !== element) return;
      this.videoPresentations +=
        previous === undefined
          ? 1
          : Math.max(0, metadata.presentedFrames - previous);
      previous = metadata.presentedFrames;
      this.videoMonitor.id = element.requestVideoFrameCallback(presented);
    };
    this.videoMonitor = {
      element,
      id: element.requestVideoFrameCallback(presented),
    };
  }
  private publish(force = false): void {
    if (this.disposed) return;
    const now = this.now();
    const elapsed = now - this.measureStart;
    if (elapsed >= 500) {
      this.metrics.submittedFps = (this.submissions * 1000) / elapsed;
      this.metrics.presentedFps = this.measuredVideo
        ? (this.videoPresentations * 1000) / elapsed
        : null;
      this.videoPresentations = 0;
      this.submissions = 0;
      this.measureStart = now;
      if (this.clock.playing && (this.metrics.submittedFps ?? 0) < 40) {
        this.lowSince ??= now;
        if (!this.low && now - this.lowSince >= 2000) {
          this.low = true;
          this.resize(this.viewport.width, this.viewport.height);
        }
      } else this.lowSince = null;
    }
    if (!force && now - this.lastPublish < 100) {
      this.publicationPending = true;
      this.schedule();
      return;
    }
    this.publicationPending = false;
    this.lastPublish = now;
    this.options.onPlayback?.(
      this.clock.currentTime,
      this.clock.playing,
      this.metrics.submittedFps,
    );
    this.options.onMetrics?.(this.debug);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.publishedScene = null;
    this.editingTextClip = null;
    this.revision++;
    if (this.raf !== null) this.cancelFrame(this.raf);
    this.raf = null;
    this.follow = null;
    if (this.videoMonitor)
      this.videoMonitor.element.cancelVideoFrameCallback(this.videoMonitor.id);
    this.videoMonitor = null;
    this.rleLoads.forEach((abort) => abort.abort());
    this.rleLoads.clear();
    this.rle.clear();
    this.pendingMasks.clear();
    this.seenActions.clear();
    this.filmstrip?.dispose();
    this.filmstripEncoder?.dispose();
    this.audio.dispose();
    this.renderer.destroy();
    [...this.imagePins.keys()].forEach((id) => this.unpinImage(id));
    this.pool.dispose();
    this.frames.clear();
    this.images.clear();
    this.imageLoads.clear();
    this.audioLoads.clear();
  }
}
