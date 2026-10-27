import { MediaPool } from './media-pool';
import { abortError, type MediaAsset, type MediaClip } from './media-types';
import type { FilmstripEncodeResponse } from './filmstrip.worker';

export interface TimestampedFrame {
  time: number;
  blob: Blob;
  exact?: boolean;
  reason?: string;
}
export interface FilmstripCacheEntry {
  frames?: readonly TimestampedFrame[];
  waveform?: Float32Array;
  /** Source-time bins, 10ms each, compatible with the Phase 3 media cache. */
  timelinePeaks?: Float32Array;
}
export interface FilmstripCache {
  /** Key is versioned asset/proxy identity, not an app-local ID. Adapter resolves localId. */
  read(
    key: string,
    asset: MediaAsset,
  ): Promise<FilmstripCacheEntry | undefined>;
  write(
    key: string,
    entry: FilmstripCacheEntry,
    asset: MediaAsset,
  ): Promise<void>;
}
export type FilmstripClip = MediaClip & { asset: MediaAsset };
export interface FilmstripOptions {
  pool: MediaPool;
  cache?: FilmstripCache;
  capture?: (video: HTMLVideoElement) => Promise<ImageBitmap>;
  encode?: (
    bitmap: ImageBitmap,
    width: number,
    height: number,
    signal?: AbortSignal,
  ) => Promise<Blob>;
  decodeAudio?: (asset: MediaAsset) => Promise<AudioBuffer>;
  fetch?: typeof fetch;
  onIssue?: (message: string) => void;
  maxEntries?: number;
  maxFrames?: number;
}
/** Legacy eight-bin midpoint timestamps are inferred, never exact cache evidence. */
export function legacyTimestampedFrames(
  frames: readonly Blob[],
  duration: number,
): TimestampedFrame[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return frames.map((blob, index) => ({
    blob,
    time: ((index + 0.5) * duration) / frames.length,
    exact: false,
    reason: 'legacy inferred bin midpoint',
  }));
}
export function filmstripTimes(
  clip: Pick<MediaClip, 'in' | 'speed' | 'duration'>,
  count: number,
): number[] {
  return Array.from(
    { length: count },
    (_, index) =>
      clip.in + ((index + 0.5) / count) * clip.duration * clip.speed,
  );
}
export function audioPeaks(buffer: AudioBuffer): FilmstripCacheEntry {
  const bins = Math.ceil(buffer.duration / 0.01);
  const timelinePeaks = new Float32Array(bins);
  const waveform = new Float32Array(64);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      const amplitude = Math.min(1, Math.abs(data[i] ?? 0));
      const bin = Math.min(bins - 1, Math.floor(i / buffer.sampleRate / 0.01));
      const small = Math.min(63, Math.floor((i / data.length) * 64));
      timelinePeaks[bin] = Math.max(timelinePeaks[bin] ?? 0, amplitude);
      waveform[small] = Math.max(waveform[small] ?? 0, amplitude);
    }
  }
  return { waveform, timelinePeaks };
}
/** Persistent worker adapter; caller owns dispose. Bitmap ownership transfers on encode. */
export class FilmstripWorkerEncoder {
  private worker?: Worker;
  private next = 0;
  private disposed = false;
  private readonly pending = new Map<
    number,
    { reject: (error: Error) => void; cleanup: () => void }
  >();
  constructor(
    private readonly createWorker: () => Worker = () =>
      new Worker(new URL('./filmstrip.worker.ts', import.meta.url), {
        type: 'module',
      }),
  ) {}
  encode(
    bitmap: ImageBitmap,
    width: number,
    height: number,
    signal?: AbortSignal,
  ): Promise<Blob> {
    if (signal?.aborted || this.disposed) {
      bitmap.close();
      return Promise.reject(abortError());
    }
    if (this.pending.size >= 6) {
      bitmap.close();
      return Promise.reject(
        new Error('Filmstrip encoding deferred: six requests pending'),
      );
    }
    let worker: Worker;
    try {
      worker = this.worker ??= this.createWorker();
    } catch (error) {
      bitmap.close();
      return Promise.reject(error);
    }
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
        worker.removeEventListener('message', done);
        worker.removeEventListener('error', failed);
        this.pending.delete(id);
      };
      const cancel = () => {
        cleanup();
        reject(abortError());
        if (!this.pending.size) {
          this.worker?.terminate();
          this.worker = undefined;
        }
      };
      const failed = () => {
        this.failPending(new Error('Filmstrip worker failed'));
      };
      const done = (event: MessageEvent<FilmstripEncodeResponse>) => {
        if (event.data.id !== id) return;
        cleanup();
        if (event.data.blob) resolve(event.data.blob);
        else
          reject(
            new Error(event.data.error ?? 'Filmstrip worker returned no frame'),
          );
      };
      const timeout = setTimeout(() => {
        this.failPending(new Error('Filmstrip worker timeout'));
      }, 10000);
      this.pending.set(id, { reject, cleanup });
      signal?.addEventListener('abort', cancel, { once: true });
      worker.addEventListener('message', done);
      worker.addEventListener('error', failed);
      try {
        worker.postMessage({ id, bitmap, width, height }, [bitmap]);
      } catch (error) {
        cleanup();
        bitmap.close();
        reject(error);
      }
    });
  }
  private failPending(error: Error): void {
    for (const entry of this.pending.values()) {
      entry.cleanup();
      entry.reject(error);
    }
    this.worker?.terminate();
    this.worker = undefined;
  }
  dispose(): void {
    this.disposed = true;
    for (const entry of this.pending.values()) {
      entry.cleanup();
      entry.reject(abortError());
    }
    this.worker?.terminate();
    this.worker = undefined;
  }
}
/** Main-thread fallback is explicit; SecurityError from tainted pixels is propagated. */
async function encodeOnMain(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Canvas encode failed')),
        'image/jpeg',
        0.8,
      ),
    );
  } finally {
    bitmap.close();
  }
}
export class FilmstripService {
  private readonly entries = new Map<string, FilmstripCacheEntry>();
  private readonly encoder = new FilmstripWorkerEncoder();
  private readonly aborters = new Set<AbortController>();
  private disposed = false;
  private sequence = 0;
  private waveforms = 0;
  constructor(private readonly options: FilmstripOptions) {}
  private key(asset: MediaAsset): string {
    return `filmstrip-v2:${asset.id}:${asset.proxyUrl ?? asset.url}:${asset.durationSec ?? 'unknown'}`;
  }
  private issue(message: string): void {
    this.options.onIssue?.(message);
  }
  private check(signal?: AbortSignal): void {
    if (this.disposed || signal?.aborted) throw abortError();
  }
  private async read(asset: MediaAsset): Promise<FilmstripCacheEntry> {
    const key = this.key(asset);
    const local = this.entries.get(key);
    if (local) return local;
    try {
      const cached = await this.options.cache?.read(key, asset);
      this.check();
      if (cached) {
        this.remember(key, cached);
        return cached;
      }
    } catch (error) {
      if (this.disposed) throw abortError();
      this.issue(
        `Media cache read failed: ${error instanceof Error ? error.message : 'cache unavailable'}`,
      );
    }
    return {};
  }
  private remember(key: string, entry: FilmstripCacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > Math.max(1, this.options.maxEntries ?? 24)) {
      const first = this.entries.keys().next().value as string | undefined;
      if (first === undefined) break;
      this.entries.delete(first);
    }
  }
  private async save(
    asset: MediaAsset,
    entry: FilmstripCacheEntry,
  ): Promise<void> {
    this.check();
    const key = this.key(asset);
    this.remember(key, entry);
    try {
      await this.options.cache?.write(key, entry, asset);
    } catch (error) {
      this.issue(
        `Media cache write failed: ${error instanceof Error ? error.message : 'quota or cache unavailable'}`,
      );
    }
  }
  async getFilmstrip(
    clip: FilmstripClip,
    widthPx: number,
    signal?: AbortSignal,
  ): Promise<readonly TimestampedFrame[]> {
    this.check(signal);
    if (
      !Number.isFinite(widthPx) ||
      widthPx <= 0 ||
      clip.duration <= 0 ||
      clip.speed <= 0
    )
      return [];
    const count = Math.min(
      Math.max(1, Math.min(128, this.options.maxFrames ?? 64)),
      Math.max(1, Math.ceil(widthPx / 80)),
    );
    const times = filmstripTimes(clip, count);
    const cached = await this.read(clip.asset);
    this.check(signal);
    const cacheFrames = cached.frames ?? [];
    const selected = times.map((time) => {
      const exact = cacheFrames.find(
        (frame) => Math.abs(frame.time - time) <= 1 / 60,
      );
      if (exact) return exact;
      // Legacy whole-source caches have only eight samples. Use real nearest samples,
      // but never pretend their timestamp equals the requested source time.
      const nearest = cacheFrames
        .filter(
          (frame) =>
            frame.time >= clip.in &&
            frame.time <= clip.in + clip.duration * clip.speed,
        )
        .reduce<TimestampedFrame | undefined>(
          (best, frame) =>
            !best || Math.abs(frame.time - time) < Math.abs(best.time - time)
              ? frame
              : best,
          undefined,
        );
      const coverage =
        (clip.asset.durationSec ?? 0) / Math.max(1, cacheFrames.length) / 2;
      return nearest && Math.abs(nearest.time - time) <= coverage
        ? {
            ...nearest,
            exact: false,
            reason: `nearest cached source sample; requested ${time}`,
          }
        : undefined;
    });
    if (selected.every((frame) => frame !== undefined))
      return selected as TimestampedFrame[];
    if (this.aborters.size >= 6)
      throw new Error('Filmstrip deferred: six extraction jobs pending');
    const controller = new AbortController();
    this.aborters.add(controller);
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const lease = this.options.pool.acquireExtraction(
      `filmstrip-${++this.sequence}`,
      clip.asset,
    );
    if (!lease) {
      this.aborters.delete(controller);
      signal?.removeEventListener('abort', cancel);
      throw new Error('Filmstrip deferred: decoder budget is used by preview');
    }
    const output: TimestampedFrame[] = [];
    try {
      for (let i = 0; i < times.length; i++) {
        this.check(controller.signal);
        const target = times[i];
        if (target === undefined) continue;
        const old = selected[i];
        if (old) {
          output.push(old);
          continue;
        }
        const frame = await lease.seek(target, { signal: controller.signal });
        this.check(controller.signal);
        if (!lease.isCurrent()) throw abortError();
        const bitmap = await (this.options.capture ?? createImageBitmap)(
          lease.element,
        );
        const height = 45;
        const width = Math.max(
          1,
          Math.round(
            (height * (lease.element.videoWidth || 16)) /
              (lease.element.videoHeight || 9),
          ),
        );
        if (this.disposed || controller.signal.aborted || !lease.isCurrent()) {
          bitmap.close();
          throw abortError();
        }
        let blob: Blob;
        if (this.options.encode)
          blob = await this.options.encode(
            bitmap,
            width,
            height,
            controller.signal,
          );
        else if (
          typeof Worker !== 'undefined' &&
          typeof OffscreenCanvas !== 'undefined'
        )
          blob = await this.encoder.encode(
            bitmap,
            width,
            height,
            controller.signal,
          );
        else {
          this.issue(
            'Worker/OffscreenCanvas unavailable; main-thread thumbnail encoding',
          );
          blob = await encodeOnMain(bitmap, width, height);
        }
        this.check(controller.signal);
        if (!lease.isCurrent()) throw abortError();
        output.push({
          time: frame.sourceTime,
          blob,
          exact: frame.exact,
          reason: frame.reason,
        });
      }
      const frames = [...cacheFrames, ...output].slice(
        -Math.max(1, this.options.maxFrames ?? 64),
      );
      await this.save(clip.asset, { ...cached, frames });
      return output;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        this.issue(
          'Cross-origin/tainted frame extraction unavailable; using real cached samples if present',
        );
        const usable = cacheFrames.filter(
          (frame) =>
            frame.time >= clip.in &&
            frame.time <= clip.in + clip.duration * clip.speed,
        );
        if (usable.length)
          return times.map((time) => {
            const nearest = usable.reduce((best, frame) =>
              Math.abs(frame.time - time) < Math.abs(best.time - time)
                ? frame
                : best,
            );
            return {
              ...nearest,
              exact: false,
              reason: `tainted extraction; nearest real cached timestamp for ${time}`,
            };
          });
      }
      throw error;
    } finally {
      lease.release();
      this.aborters.delete(controller);
      signal?.removeEventListener('abort', cancel);
    }
  }
  async getWaveform(
    clip: FilmstripClip,
    points: number,
    signal?: AbortSignal,
  ): Promise<Float32Array> {
    this.check(signal);
    if (this.waveforms >= 2)
      throw new Error('Waveform deferred: two jobs pending');
    this.waveforms++;
    try {
      return await this.readWaveform(clip, points, signal);
    } finally {
      this.waveforms--;
    }
  }
  private async readWaveform(
    clip: FilmstripClip,
    points: number,
    signal?: AbortSignal,
  ): Promise<Float32Array> {
    this.check(signal);
    const count = Math.max(0, Math.min(10000, Math.floor(points)));
    if (!Number.isFinite(count) || count === 0) return new Float32Array();
    let cached = await this.read(clip.asset);
    this.check(signal);
    if (!cached.timelinePeaks) {
      let buffer: AudioBuffer;
      if (this.options.decodeAudio)
        buffer = await this.options.decodeAudio(clip.asset);
      else {
        const context = new AudioContext();
        try {
          const response = await (this.options.fetch ?? fetch)(
            clip.asset.proxyUrl ?? clip.asset.url,
            { mode: 'cors', signal },
          );
          if (!response.ok) throw new Error(`Waveform HTTP ${response.status}`);
          buffer = await context.decodeAudioData(await response.arrayBuffer());
        } finally {
          await context.close();
        }
      }
      this.check(signal);
      cached = { ...cached, ...audioPeaks(buffer) };
      await this.save(clip.asset, cached);
    }
    const peaks = cached.timelinePeaks;
    if (!peaks) throw new Error('No waveform source bins');
    const result = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const start = Math.floor(
        (clip.in + (i / count) * clip.duration * clip.speed) / 0.01,
      );
      const end = Math.ceil(
        (clip.in + ((i + 1) / count) * clip.duration * clip.speed) / 0.01,
      );
      for (
        let bin = Math.max(0, start);
        bin < Math.min(peaks.length, end);
        bin++
      )
        result[i] = Math.max(result[i] ?? 0, peaks[bin] ?? 0);
    }
    return result;
  }
  dispose(): void {
    this.disposed = true;
    for (const aborter of this.aborters) aborter.abort();
    this.aborters.clear();
    this.encoder.dispose();
    this.entries.clear();
  }
}
