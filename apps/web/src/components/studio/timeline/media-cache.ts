import type { Clip } from '@kimo/client';
import type { TimelineMediaHandle } from './types';
export interface TimelineFrame {
  time: number;
  image: HTMLImageElement;
  url: string;
}
export interface TimelineMedia {
  frames?: readonly TimelineFrame[];
  waveform?: Float32Array;
}
interface Entry {
  controller: AbortController;
  value?: TimelineMedia;
  pending: boolean;
}
/** Only samples the injected compositor. Never owns decoders, audio, or borrowed bitmaps. */
export class TimelineMediaCache {
  private entries = new Map<string, Entry>();
  private queue: { key: string; run: () => Promise<void> }[] = [];
  private active = 0;
  private disposed = false;
  constructor(
    private handle: TimelineMediaHandle,
    private changed: () => void,
    private concurrency = 2,
    private budget = 48,
  ) {}
  key(clip: Clip, width: number) {
    return `${clip.id}:${clip.assetId}:${clip.in}:${clip.speed}:${clip.duration}:${Math.ceil(width / 80)}`;
  }
  read(clip: Clip, width: number): TimelineMedia | undefined {
    return this.entries.get(this.key(clip, width))?.value;
  }
  request(clip: Clip, width: number) {
    if (this.disposed || !['audio', 'video', 'image'].includes(clip.kind))
      return;
    const bounded = Math.max(80, Math.min(1280, width));
    const key = this.key(clip, bounded);
    if (this.entries.has(key)) return;
    // Do not evict another still-visible request and thrash on 50+ clip views.
    // The caller prunes stale keys before adding newly visible work.
    if (this.entries.size >= this.budget) return;
    const entry: Entry = { controller: new AbortController(), pending: true };
    this.entries.set(key, entry);
    this.queue.push({
      key,
      run: async () => {
        const signal = entry.controller.signal;
        if (signal.aborted) return;
        const owned: TimelineFrame[] = [];
        try {
          if (clip.kind === 'audio') {
            const waveform = await this.handle.getWaveform?.(
              clip.id,
              Math.min(1280, Math.ceil(bounded)),
              signal,
            );
            if (!signal.aborted) entry.value = { waveform };
          } else {
            const frames = await this.handle.getFilmstrip?.(
              clip.id,
              bounded,
              signal,
            );
            for (const frame of frames ?? []) {
              if (signal.aborted) break;
              const url = URL.createObjectURL(frame.blob);
              const image = new Image();
              owned.push({ time: frame.time, image, url });
              image.src = url;
              await image.decode();
            }
            if (!signal.aborted) entry.value = { frames: owned };
          }
        } catch {
          /* Unavailable source stays empty, never synthetic. */
        } finally {
          if (!entry.value?.frames)
            for (const frame of owned) URL.revokeObjectURL(frame.url);
          entry.pending = false;
          if (!signal.aborted && !this.disposed) this.changed();
        }
      },
    });
    this.pump();
  }
  private pump() {
    while (
      !this.disposed &&
      this.active < this.concurrency &&
      this.queue.length
    ) {
      const job = this.queue.shift();
      if (!job) break;
      this.active++;
      void job.run().finally(() => {
        this.active--;
        this.pump();
      });
    }
  }
  retain(keys: ReadonlySet<string>) {
    for (const key of this.entries.keys()) if (!keys.has(key)) this.remove(key);
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    entry?.controller.abort();
    for (const frame of entry?.value?.frames ?? [])
      URL.revokeObjectURL(frame.url);
    this.entries.delete(key);
    this.queue = this.queue.filter((job) => job.key !== key);
  }
  dispose() {
    this.disposed = true;
    this.queue = [];
    for (const key of this.entries.keys()) this.remove(key);
  }
}
