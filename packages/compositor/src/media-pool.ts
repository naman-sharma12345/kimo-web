import {
  abortError,
  type MediaAsset,
  type MediaFrame,
  type MediaSyncResult,
  type VideoRequest,
} from './media-types';

interface ImageEntry {
  url: string;
  promise: Promise<ImageBitmap>;
  bitmap?: ImageBitmap;
  controller: AbortController;
  refs: number;
}
export interface MediaPoolOptions {
  createVideo?: () => HTMLVideoElement;
  fetch?: typeof fetch;
  createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
  timeoutMs?: number;
  maxDecoders?: number;
  maxImages?: number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}
interface Slot {
  element: HTMLVideoElement;
  id: string | null;
  url: string;
  asset?: MediaAsset;
  purpose: 'video' | 'mask' | 'extraction' | 'warmup';
  cancel?: () => void;
  frame?: MediaFrame;
  revision: number;
  epoch: number;
  playbackCallback?: number;
}
export interface SeekOptions {
  fps?: number;
  fast?: boolean;
  signal?: AbortSignal;
}
export interface ImageLease {
  bitmap: ImageBitmap;
  release(): void;
}
export interface ExtractionLease {
  element: HTMLVideoElement;
  isCurrent(): boolean;
  seek(time: number, options?: SeekOptions): Promise<MediaFrame>;
  release(): void;
}
/** Physical elements remain reusable until dispose; all purposes share the same budget. */
export class MediaPool {
  private readonly options: MediaPoolOptions;
  private readonly slots: Slot[] = [];
  private readonly images = new Map<string, ImageEntry>();
  private disposed = false;
  private generation = 0;
  private epoch = 0;
  constructor(options: MediaPoolOptions = {}) {
    this.options = options;
  }
  get decoderCount(): number {
    return this.slots.filter((slot) => slot.id !== null).length;
  }
  get physicalElementCount(): number {
    return this.slots.length;
  }
  private get limit(): number {
    return Math.max(1, Math.min(6, this.options.maxDecoders ?? 6));
  }
  private assertAlive(): void {
    if (this.disposed) throw new Error('MediaPool disposed');
  }
  private clear(slot: Slot): void {
    slot.cancel?.();
    slot.revision++;
    slot.epoch = ++this.epoch;
    this.stopMonitor(slot);
    slot.element.pause();
    slot.element.muted = true;
    slot.element.removeAttribute('src');
    slot.element.load();
    slot.id = null;
    slot.url = '';
    slot.asset = undefined;
    slot.frame = undefined;
  }
  private allocate(
    id: string,
    asset: MediaAsset,
    purpose: Slot['purpose'],
  ): Slot | undefined {
    this.assertAlive();
    let slot = this.slots.find((item) => item.id === id);
    const url = asset.proxyUrl ?? asset.url;
    if (
      slot &&
      slot.asset?.id === asset.id &&
      slot.asset.url === asset.url &&
      slot.asset.proxyUrl === asset.proxyUrl
    )
      return slot;
    if (slot) this.clear(slot);
    slot ??= this.slots.find((item) => item.id === null);
    if (!slot && this.slots.length < this.limit) {
      const element = (
        this.options.createVideo ?? (() => document.createElement('video'))
      )();
      slot = {
        element,
        id: null,
        url: '',
        purpose,
        revision: 0,
        epoch: ++this.epoch,
      };
      this.slots.push(slot);
    }
    if (!slot) return undefined;
    slot.id = id;
    slot.asset = asset;
    slot.purpose = purpose;
    slot.url = url;
    const video = slot.element;
    video.crossOrigin = 'anonymous'; // MUST precede src, including original fallback.
    video.muted = true;
    video.preservesPitch = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    video.load();
    return slot;
  }
  getVideo(clipId: string): HTMLVideoElement | undefined {
    return this.slots.find((slot) => slot.id === clipId)?.element;
  }
  /** Moves ownership, clearing the caller's map. Excess warmups are physically unloaded. */
  adoptWarmup(videos: Map<string, HTMLVideoElement>): void {
    this.assertAlive();
    for (const [id, element] of videos) {
      element.pause();
      element.muted = true;
      if (this.slots.some((slot) => slot.element === element)) continue;
      if (this.slots.length >= this.limit) {
        element.removeAttribute('src');
        element.load();
        continue;
      }
      // Re-load after setting CORS: old warmup API did not set it before src.
      const url = element.getAttribute('src') ?? element.src;
      element.removeAttribute('src');
      element.crossOrigin = 'anonymous';
      element.src = url;
      element.load();
      this.slots.push({
        id: `warmup:${id}`,
        element,
        url,
        purpose: 'warmup',
        revision: 0,
        epoch: ++this.epoch,
      });
    }
    videos.clear();
  }
  release(clipId: string): void {
    const slot = this.slots.find((item) => item.id === clipId);
    if (slot) this.clear(slot);
  }
  /** Resolves only on timestamp evidence or an explicitly degraded fallback. */
  seek(
    clipId: string,
    time: number,
    options: SeekOptions = {},
  ): Promise<MediaFrame> {
    this.assertAlive();
    const slot = this.slots.find((item) => item.id === clipId);
    if (!slot) return Promise.reject(new Error('Decoder unavailable'));
    if (
      options.fps !== undefined &&
      (!Number.isFinite(options.fps) || options.fps <= 0)
    )
      return Promise.reject(new RangeError('Invalid project fps'));
    if (!Number.isFinite(time) || time < 0)
      return Promise.reject(new RangeError('Invalid source time'));
    if (options.signal?.aborted) return Promise.reject(abortError());
    slot.cancel?.();
    this.stopMonitor(slot);
    slot.element.pause();
    const revision = ++slot.revision;
    const video = slot.element;
    const target = Number.isFinite(video.duration)
      ? Math.min(time, Math.max(0, video.duration - 0.000001))
      : time;
    const tolerance = 0.5 / (options.fps ?? 30);
    if (options.signal?.aborted) return Promise.reject(abortError());
    if (
      !options.fast &&
      video.readyState >= 2 &&
      slot.frame?.exact &&
      Math.abs(slot.frame.sourceTime - target) <= tolerance &&
      !video.seeking &&
      Math.abs(video.currentTime - target) <= tolerance
    )
      return Promise.resolve(slot.frame);
    return new Promise((resolve, reject) => {
      let callback: number | undefined;
      let finished = false;
      const cleanup = () => {
        if (callback !== undefined) video.cancelVideoFrameCallback?.(callback);
        if (timeout !== undefined)
          (this.options.clearTimeout ?? clearTimeout)(timeout);
        video.removeEventListener('seeked', seeked);
        video.removeEventListener('error', failed);
        video.removeEventListener('loadedmetadata', assign);
        options.signal?.removeEventListener('abort', cancel);
        if (slot.cancel === cancel) slot.cancel = undefined;
      };
      const cancel = () => {
        if (!finished) {
          finished = true;
          cleanup();
          reject(abortError());
        }
      };
      const finish = (
        exact: boolean,
        presentedTime: number,
        reason?: string,
      ) => {
        if (finished || revision !== slot.revision) return;
        finished = true;
        cleanup();
        const frame: MediaFrame = {
          element: video,
          sourceTime: presentedTime,
          exact,
          reason,
        };
        slot.frame = frame;
        resolve(frame);
      };
      const failed = () => {
        if (!finished) {
          finished = true;
          cleanup();
          reject(new Error(`Media failed: ${slot.url}`));
        }
      };
      const seeked = () => {
        if (!video.requestVideoFrameCallback || options.fast)
          finish(
            false,
            video.currentTime,
            options.fast ? 'fast-seek' : 'seeked-only; no presented timestamp',
          );
      };
      const presented: VideoFrameRequestCallback = (_now, metadata) => {
        if (finished || revision !== slot.revision) return;
        if (Math.abs(metadata.mediaTime - target) <= tolerance)
          finish(
            !options.fast,
            metadata.mediaTime,
            options.fast ? 'fast-seek' : undefined,
          );
        else callback = video.requestVideoFrameCallback(presented);
      };
      const assign = () => {
        try {
          if (options.fast && video.fastSeek) video.fastSeek(target);
          else video.currentTime = target;
        } catch {
          failed();
        }
      };
      slot.cancel = cancel;
      video.addEventListener('seeked', seeked);
      video.addEventListener('error', failed);
      options.signal?.addEventListener('abort', cancel, { once: true });
      // Register before currentTime: the first presented callback must not be lost.
      if (video.requestVideoFrameCallback)
        callback = video.requestVideoFrameCallback(presented);
      const timeout = (this.options.setTimeout ?? setTimeout)(() => {
        if (
          video.readyState >= 2 &&
          !video.seeking &&
          Math.abs(video.currentTime - target) <= tolerance
        )
          finish(
            false,
            video.currentTime,
            'presented timestamp timeout; retained decoded element only',
          );
        else {
          finished = true;
          cleanup();
          reject(new Error('Seek timed out; retain previous frame'));
        }
      }, this.options.timeoutMs ?? 1500);
      if (video.readyState === 0)
        video.addEventListener('loadedmetadata', assign, { once: true });
      else assign();
    });
  }
  private stopMonitor(slot: Slot): void {
    if (slot.playbackCallback !== undefined)
      slot.element.cancelVideoFrameCallback?.(slot.playbackCallback);
    slot.playbackCallback = undefined;
  }
  private monitor(slot: Slot): void {
    if (
      !slot.element.requestVideoFrameCallback ||
      slot.playbackCallback !== undefined
    )
      return;
    const epoch = slot.epoch;
    const presented: VideoFrameRequestCallback = (_now, metadata) => {
      if (slot.epoch !== epoch || !slot.id) return;
      slot.frame = {
        element: slot.element,
        sourceTime: metadata.mediaTime,
        exact: true,
      };
      slot.playbackCallback = slot.element.requestVideoFrameCallback(presented);
    };
    slot.playbackCallback = slot.element.requestVideoFrameCallback(presented);
  }
  async sync(
    requests: readonly VideoRequest[],
    state: {
      time: number;
      playing: boolean;
      rate?: number;
      fps?: number;
      fast?: boolean;
    },
  ): Promise<MediaSyncResult> {
    this.assertAlive();
    const generation = ++this.generation;
    const rate = state.rate ?? 1;
    if (!Number.isFinite(state.time) || state.time < 0)
      throw new RangeError('Invalid timeline time');
    if (!Number.isFinite(rate) || rate === 0)
      throw new RangeError('Invalid playback rate');
    const candidates = requests
      .filter(
        (item) =>
          item.start + item.duration > state.time &&
          item.start <= state.time + (state.playing && rate > 0 ? 1.5 : 0),
      )
      .sort(
        (a, b) =>
          Math.max(0, a.start - state.time) - Math.max(0, b.start - state.time),
      );
    const selected = candidates.slice(0, this.limit);
    const ids = new Set(selected.map((item) => item.clipId));
    for (const slot of this.slots)
      if (slot.id && slot.purpose !== 'extraction' && !ids.has(slot.id))
        this.clear(slot);
    // Playback always preempts low-priority extraction leases.
    const needed = selected.filter(
      (item) => !this.getVideo(item.clipId),
    ).length;
    let free =
      this.slots.filter((slot) => !slot.id).length +
      this.limit -
      this.slots.length;
    for (const slot of this.slots)
      if (free < needed && slot.purpose === 'extraction' && slot.id) {
        this.clear(slot);
        free++;
      }
    const frames = new Map<string, MediaFrame>();
    const issues =
      candidates.length > selected.length
        ? ['decoder budget exceeded; retain previous frames']
        : [];
    if (rate < 0)
      issues.push(
        'reverse preview is silent stepped exact seeks, not reverse decoding',
      );
    await Promise.all(
      selected.map(async (request) => {
        const slot = this.allocate(
          request.clipId,
          request.asset,
          request.purpose ?? 'video',
        );
        if (!slot) {
          issues.push(`decoder unavailable: ${request.clipId}`);
          return;
        }
        const sourceRate = request.sourceTiming?.rate ?? request.speed;
        const time = request.sourceTiming
          ? request.sourceTiming.mediaTime +
            (state.time - request.sourceTiming.timelineTime) * sourceRate
          : request.in +
            Math.max(0, state.time - request.start) * request.speed;
        const legacyMask = request.purpose === 'mask' && !request.sourceTiming;
        if (legacyMask)
          issues.push(
            `${request.clipId}: mask source timing descriptor missing; legacy timing is degraded`,
          );
        if (
          !Number.isFinite(time) ||
          !Number.isFinite(sourceRate) ||
          sourceRate < 0
        ) {
          issues.push(`${request.clipId}: invalid media source timing`);
          return;
        }
        try {
          let frame: MediaFrame;
          try {
            if (
              state.playing &&
              rate > 0 &&
              sourceRate > 0 &&
              !slot.element.paused &&
              slot.frame &&
              Math.abs(slot.element.currentTime - time) <= 0.1
            ) {
              const close =
                Math.abs(slot.frame.sourceTime - time) <=
                0.5 / (state.fps ?? 30);
              frame = {
                ...slot.frame,
                exact: slot.frame.exact && close,
                reason: close
                  ? slot.frame.reason
                  : 'playback timestamp differs from timeline target',
              };
            } else
              frame = await this.seek(request.clipId, time, {
                fps: state.fps,
                fast: state.fast,
              });
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError')
              throw error;
            if (request.asset.proxyUrl && slot.url !== request.asset.url) {
              slot.url = request.asset.url;
              slot.frame = undefined;
              slot.element.crossOrigin = 'anonymous';
              slot.element.src = slot.url;
              slot.element.load();
              issues.push(`proxy failed; using original: ${request.clipId}`);
              frame = await this.seek(request.clipId, time, {
                fps: state.fps,
                fast: state.fast,
              });
            } else throw error;
          }
          if (generation !== this.generation) throw abortError();
          if (
            state.playing &&
            rate > 0 &&
            sourceRate > 0 &&
            state.time >= request.start
          ) {
            slot.element.playbackRate = sourceRate * rate;
            // AudioEngine owns unmuting after graph connection, masks always silent.
            if (request.purpose === 'mask') slot.element.muted = true;
            await slot.element.play();
            if (generation !== this.generation) throw abortError();
            this.monitor(slot);
          } else {
            this.stopMonitor(slot);
            slot.element.pause();
            slot.element.muted = true;
          }
          if (legacyMask)
            frame = {
              ...frame,
              exact: false,
              reason:
                'mask source timing descriptor missing; legacy timing is degraded',
            };
          frames.set(request.clipId, frame);
          if (frame.reason) issues.push(`${request.clipId}: ${frame.reason}`);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError')
            return;
          issues.push(
            `${request.clipId}: ${error instanceof Error ? error.message : 'media unavailable'}`,
          );
        }
      }),
    );
    if (generation !== this.generation) throw abortError();
    return { frames, issues };
  }
  acquireExtraction(id: string, asset: MediaAsset): ExtractionLease | null {
    const key = `extraction:${id}:${++this.epoch}`;
    const slot = this.allocate(key, asset, 'extraction');
    if (!slot) return null;
    const epoch = slot.epoch;
    return {
      element: slot.element,
      isCurrent: () =>
        slot.id === key && slot.epoch === epoch && !this.disposed,
      seek: async (time, options) => {
        if (slot.id !== key || slot.epoch !== epoch) throw abortError();
        try {
          return await this.seek(key, time, options);
        } catch (error) {
          if (
            slot.id !== key ||
            slot.epoch !== epoch ||
            (error instanceof DOMException && error.name === 'AbortError')
          )
            throw error;
          if (!asset.proxyUrl || slot.url === asset.url) throw error;
          slot.url = asset.url;
          slot.frame = undefined;
          slot.element.crossOrigin = 'anonymous';
          slot.element.src = slot.url;
          slot.element.load();
          const frame = await this.seek(key, time, options);
          return {
            ...frame,
            reason: `proxy failed; original source${frame.reason ? `; ${frame.reason}` : ''}`,
          };
        }
      },
      release: () => {
        if (slot.id === key && slot.epoch === epoch) this.clear(slot);
      },
    };
  }
  private imageKey(asset: MediaAsset): string {
    return JSON.stringify([asset.id, asset.proxyUrl ?? asset.url]);
  }
  /** Borrowed cache value. Renderers should use acquireImage to pin its lifetime. */
  loadImage(asset: MediaAsset): Promise<ImageBitmap> {
    this.assertAlive();
    const url = asset.proxyUrl ?? asset.url;
    const key = this.imageKey(asset);
    const old = this.images.get(key);
    if (old) return old.promise;
    const limit = Math.max(1, Math.min(128, this.options.maxImages ?? 32));
    while (this.images.size >= limit) {
      const free = [...this.images].find(([, entry]) => entry.refs === 0);
      if (!free)
        return Promise.reject(
          new Error('Image cache capacity pinned; release an image lease'),
        );
      free[1].controller.abort();
      free[1].bitmap?.close();
      this.images.delete(free[0]);
    }
    const entry: ImageEntry = {
      url,
      refs: 0,
      controller: new AbortController(),
      promise: Promise.resolve().then(async () => {
        const response = await (this.options.fetch ?? fetch)(url, {
          mode: 'cors',
          signal: entry.controller.signal,
        });
        if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
        const bitmap = await (
          this.options.createImageBitmap ?? createImageBitmap
        )(await response.blob());
        if (this.disposed || this.images.get(key) !== entry) {
          bitmap.close();
          throw abortError();
        }
        entry.bitmap = bitmap;
        return bitmap;
      }),
    };
    this.images.set(key, entry);
    void entry.promise.catch(() => {
      if (this.images.get(key) === entry) this.images.delete(key);
    });
    return entry.promise;
  }
  async acquireImage(asset: MediaAsset): Promise<ImageLease> {
    const promise = this.loadImage(asset);
    const entry = this.images.get(this.imageKey(asset));
    if (!entry) {
      await promise;
      throw new Error('Image cache entry unavailable');
    }
    entry.refs++;
    try {
      const bitmap = await promise;
      let released = false;
      return {
        bitmap,
        release: () => {
          if (!released) {
            released = true;
            entry.refs--;
          }
        },
      };
    } catch (error) {
      entry.refs--;
      throw error;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.generation++;
    this.disposed = true;
    for (const slot of this.slots) this.clear(slot);
    this.slots.length = 0;
    for (const entry of this.images.values()) {
      entry.controller.abort();
      entry.bitmap?.close();
    }
    this.images.clear();
  }
}
