import { interpolateKeyframes } from './scene-builder';
import {
  audible,
  sourceTime,
  type MediaAsset,
  type MediaClip,
  type MediaTrack,
} from './media-types';

export const DUCK_GAIN = Math.pow(10, -12 / 20);
export const DUCK_SECONDS = 0.3;
export const SCRUB_SECONDS = 0.06;
/** Actual post-master time-domain samples, never a volume estimate. */
export interface AudioLevels {
  available: boolean;
  state: 'measuring' | 'paused' | 'suspended' | 'unavailable' | 'disposed';
  peak: number;
  rms: number;
  peakDb: number | null;
  rmsDb: number | null;
}
export interface AudioCapabilities {
  keepPitch: boolean;
  reason?: string;
}
export function audioCapabilities(kind: string): AudioCapabilities {
  return kind === 'video'
    ? { keepPitch: true }
    : {
        keepPitch: false,
        reason:
          'Pitch-preserving buffered audio is unavailable; native video pitch control only',
      };
}
export interface AudioEngineOptions {
  context?: AudioContext;
  createContext?: () => AudioContext;
  fetch?: typeof fetch;
  onIssue?: (issue: string) => void;
  maxBuffers?: number;
}
interface Voice {
  gain: GainNode;
  duck: GainNode;
  source?: AudioBufferSourceNode;
  element?: HTMLMediaElement;
  mediaSource?: MediaElementAudioSourceNode;
  signature: string;
  duckFrom: number;
  duckTo: number;
  duckStart: number;
  ended?: boolean;
}
// The browser forbids creating a second source for an element in the same context,
// even after disconnect(). Keep that identity separate from short-lived clip graphs.
const elementSources = new WeakMap<
  AudioContext,
  WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>
>();
type VolumeKey = Parameters<typeof interpolateKeyframes>[0][number];
function volumeKeys(clip: MediaClip): VolumeKey[] {
  return (clip.keyframes ?? [])
    .filter(
      (key) => key.property === 'volume' || key.property === 'transform.volume',
    )
    .map((key): VolumeKey => {
      const easing =
        key.easing === 'linear' ||
        key.easing === 'hold' ||
        key.easing === 'ease_out' ||
        key.easing === 'ease_in_out' ||
        key.easing === 'bezier'
          ? key.easing
          : undefined;
      const [x1, y1, x2, y2] = key.bezier ?? [];
      const bezier: VolumeKey['bezier'] =
        x1 !== undefined &&
        y1 !== undefined &&
        x2 !== undefined &&
        y2 !== undefined
          ? [x1, y1, x2, y2]
          : undefined;
      return {
        property: key.property,
        time: key.time,
        value: key.value,
        easing,
        bezier,
      };
    });
}
/** Clip-local linear fades multiply keyed gain; no master or duck is applied here. */
export function fadeGainAt(clip: MediaClip, localTime: number): number {
  const unit = (n: number) => Math.max(0, Math.min(1, n));
  return (
    (clip.fadeInSec ? unit(localTime / clip.fadeInSec) : 1) *
    (clip.fadeOutSec ? unit((clip.duration - localTime) / clip.fadeOutSec) : 1)
  );
}
/** Same exported interpolation as pure scene audio; master/duck/gates are NOT inputs here. */
export function volumeAt(clip: MediaClip, localTime: number): number {
  return (
    Math.max(
      0,
      interpolateKeyframes(
        volumeKeys(clip),
        localTime + (clip.animationOffsetSec ?? 0),
        clip.volume ?? 1,
      ),
    ) * fadeGainAt(clip, localTime)
  );
}
export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private analyser?: AnalyserNode;
  private samples?: Float32Array<ArrayBuffer>;
  private playing = false;
  private readonly options: AudioEngineOptions;
  private readonly voices = new Map<string, Voice>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<
    string,
    { url: string; promise: Promise<AudioBuffer>; controller: AbortController }
  >();
  private readonly urls = new Map<string, string>();
  private readonly bufferVersions = new Map<string, number>();
  private readonly blips = new Map<AudioBufferSourceNode, GainNode>();
  private lastTime?: number;
  private lastContextTime = 0;
  private lastRate = 1;
  private lastEpoch: number | undefined;
  private disposed = false;
  private active = false;
  private activeLoads = 0;
  private nextBufferVersion = 0;
  constructor(options: AudioEngineOptions = {}) {
    this.options = options;
    this.context = options.context;
  }
  private issue(message: string): void {
    this.options.onIssue?.(message);
  }
  private getContext(): AudioContext {
    if (this.disposed) throw new Error('AudioEngine disposed');
    this.context ??= (
      this.options.createContext ?? (() => new AudioContext())
    )();
    if (!this.master) {
      this.master = this.context.createGain();
      // Some injected/legacy contexts lack analyser support. Playback still works.
      if (typeof this.context.createAnalyser === 'function') {
        try {
          this.analyser = this.context.createAnalyser();
          this.analyser.fftSize = 2048;
          this.samples = new Float32Array(this.analyser.fftSize);
          this.analyser.connect(this.context.destination);
          this.master.connect(this.analyser);
        } catch {
          this.analyser?.disconnect();
          this.analyser = undefined;
          this.samples = undefined;
          this.master.connect(this.context.destination);
          this.issue('Output audio analyser unavailable');
        }
      } else this.master.connect(this.context.destination);
    }
    return this.context;
  }
  /** Call from a user gesture. Rejection is reported and never mistaken for playback. */
  async resume(): Promise<boolean> {
    try {
      const context = this.getContext();
      if (context.state !== 'running') await context.resume();
      return context.state === 'running';
    } catch (error) {
      this.issue(
        `Audio activation required: ${error instanceof Error ? error.message : 'resume denied'}`,
      );
      return false;
    }
  }
  /** Samples only the existing graph while playing. Zeroes immediately on pause/dispose. */
  getLevels(): AudioLevels {
    const available = !this.disposed && !!this.analyser && !!this.samples;
    const state: AudioLevels['state'] = this.disposed
      ? 'disposed'
      : !available
        ? 'unavailable'
        : !this.playing
          ? 'paused'
          : this.context?.state !== 'running'
            ? 'suspended'
            : 'measuring';
    let peak = 0,
      sum = 0;
    if (state === 'measuring' && this.analyser && this.samples) {
      this.analyser.getFloatTimeDomainData(this.samples);
      for (const value of this.samples) {
        const sample = Number.isFinite(value) ? value : 0;
        peak = Math.max(peak, Math.abs(sample));
        sum += sample * sample;
      }
    }
    const rms = this.samples ? Math.sqrt(sum / this.samples.length) : 0;
    return {
      available,
      state,
      peak,
      rms,
      peakDb: peak > 0 ? 20 * Math.log10(peak) : null,
      rmsDb: rms > 0 ? 20 * Math.log10(rms) : null,
    };
  }
  audioTime(): number | null {
    return this.active && this.context?.state === 'running'
      ? this.context.currentTime
      : null;
  }
  setBuffer(assetId: string, buffer: AudioBuffer): void {
    if (this.disposed) throw new Error('AudioEngine disposed');
    this.bufferVersions.set(assetId, ++this.nextBufferVersion);
    this.buffers.delete(assetId);
    this.buffers.set(assetId, buffer);
    while (this.buffers.size > Math.max(1, this.options.maxBuffers ?? 32)) {
      const key = this.buffers.keys().next().value as string | undefined;
      if (key === undefined) break;
      this.buffers.delete(key);
      this.urls.delete(key);
      this.bufferVersions.delete(key);
    }
  }
  loadBuffer(asset: MediaAsset): Promise<AudioBuffer> {
    const url = asset.proxyUrl ?? asset.url;
    const cached = this.buffers.get(asset.id);
    if (cached && this.urls.get(asset.id) === url)
      return Promise.resolve(cached);
    const pending = this.loading.get(asset.id);
    if (pending?.url === url) return pending.promise;
    if (this.activeLoads >= 4)
      return Promise.reject(
        new Error('Audio decode deferred: four loads pending'),
      );
    pending?.controller.abort();
    const context = this.getContext();
    this.activeLoads++;
    const entry = {
      url,
      controller: new AbortController(),
      promise: Promise.resolve().then(async () => {
        const decode = async (sourceUrl: string) => {
          const response = await (this.options.fetch ?? fetch)(sourceUrl, {
            mode: 'cors',
            signal: entry.controller.signal,
          });
          if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
          return context.decodeAudioData(await response.arrayBuffer());
        };
        let buffer: AudioBuffer;
        try {
          buffer = await decode(url);
        } catch (error) {
          if (entry.controller.signal.aborted || !asset.proxyUrl) throw error;
          this.issue(`Audio proxy failed; decoding original: ${asset.id}`);
          buffer = await decode(asset.url);
        }
        if (this.disposed || this.loading.get(asset.id) !== entry)
          throw new Error('Audio load superseded');
        this.urls.set(asset.id, url);
        this.setBuffer(asset.id, buffer);
        return buffer;
      }),
    };
    this.loading.set(asset.id, entry);
    void entry.promise.then(
      () => {
        this.activeLoads--;
        if (this.loading.get(asset.id) === entry) this.loading.delete(asset.id);
      },
      (error: unknown) => {
        this.activeLoads--;
        if (this.loading.get(asset.id) === entry) this.loading.delete(asset.id);
        if (this.disposed) return;
        this.issue(
          `Audio decode failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      },
    );
    return entry.promise;
  }
  private remove(id: string): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    if (voice.source) {
      try {
        voice.source.stop();
      } catch {
        /* Already ended one-shot. */
      }
      voice.source.disconnect();
    }
    if (voice.element) voice.element.muted = true;
    if (voice.mediaSource) voice.mediaSource.disconnect();
    voice.gain.disconnect();
    voice.duck.disconnect();
    this.voices.delete(id);
  }
  private clearBlips(): void {
    for (const [source, gain] of this.blips) {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
      source.disconnect();
      gain.disconnect();
    }
    this.blips.clear();
  }
  private envelope(
    voice: Voice,
    clip: MediaClip,
    time: number,
    rate: number,
    gate: number,
  ): void {
    const now = this.getContext().currentTime;
    const gain = voice.gain.gain;
    // Clearing all owned automation also cancels a curve whose start precedes now.
    // cancelScheduledValues(now) alone would leave an in-progress curve overlapping its replacement.
    gain.cancelScheduledValues(0);
    const keys = [
      ...new Map(volumeKeys(clip).map((key) => [key.time, key])).values(),
    ].sort((a, b) => a.time - b.time);
    const at = (timeline: number) =>
      volumeAt(clip, timeline - clip.start) * gate;
    gain.setValueAtTime(at(time), now);
    if (!keys.length && !clip.fadeInSec && !clip.fadeOutSec) return;
    const end = Math.min(clip.start + clip.duration, time + 1.5);
    const boundaries = keys
      .map((key) => clip.start + key.time - (clip.animationOffsetSec ?? 0))
      .filter((t) => t > time && t < end);
    for (const boundary of [
      clip.start + (clip.fadeInSec ?? 0),
      clip.start + clip.duration - (clip.fadeOutSec ?? 0),
    ])
      if (boundary > time && boundary < end) boundaries.push(boundary);
    boundaries.push(end);
    boundaries.sort((a, b) => a - b);
    let start = time;
    for (const stop of boundaries) {
      if (stop <= start) continue;
      const q = start - clip.start + (clip.animationOffsetSec ?? 0);
      const left = keys.filter((key) => key.time <= q).at(-1);
      const after = keys.some((key) => key.time > q);
      const when = now + (start - time) / rate;
      const until = now + (stop - time) / rate;
      if (
        !!clip.fadeInSec ||
        !!clip.fadeOutSec ||
        (after &&
          (left?.easing === 'ease_out' ||
            left?.easing === 'ease_in_out' ||
            left?.easing === 'bezier'))
      ) {
        // WebAudio linearly interpolates these bounded samples of the exact shared easing.
        const holdBoundary =
          left?.easing === 'hold' &&
          keys.some(
            (key) =>
              Math.abs(
                clip.start + key.time - (clip.animationOffsetSec ?? 0) - stop,
              ) < 1e-9,
          );
        const values = Float32Array.from({ length: 129 }, (_, index) =>
          holdBoundary && index === 128
            ? Math.max(0, left.value) *
              fadeGainAt(clip, stop - clip.start) *
              gate
            : at(start + ((stop - start) * index) / 128),
        );
        gain.setValueCurveAtTime(values, when, until - when);
        if (holdBoundary) gain.setValueAtTime(at(stop), until);
      } else if (after && left?.easing === 'hold')
        gain.setValueAtTime(at(stop), until);
      else gain.linearRampToValueAtTime(at(stop), until);
      start = stop;
    }
  }

  private duck(voice: Voice, target: number, now: number): void {
    if (target === voice.duckTo) return;
    const progress = Math.max(
      0,
      Math.min(1, (now - voice.duckStart) / DUCK_SECONDS),
    );
    const current = voice.duckFrom + (voice.duckTo - voice.duckFrom) * progress;
    voice.duck.gain.cancelScheduledValues(now);
    voice.duck.gain.setValueAtTime(current, now);
    voice.duck.gain.linearRampToValueAtTime(target, now + DUCK_SECONDS);
    voice.duckFrom = current;
    voice.duckTo = target;
    voice.duckStart = now;
  }
  /** Reconcile on each transport tick; discontinuities restart one-shot sources. */
  sync(
    clips: readonly MediaClip[],
    tracks: readonly MediaTrack[],
    time: number,
    state: { playing: boolean; rate?: number; master?: number; epoch?: number },
    elements: ReadonlyMap<string, HTMLMediaElement> = new Map(),
  ): void {
    if (!state.playing || (state.rate ?? 1) <= 0) {
      this.pause();
      return;
    }
    const rate = state.rate ?? 1;
    if (!Number.isFinite(rate) || !Number.isFinite(time))
      throw new RangeError('Invalid audio transport');
    const context = this.getContext();
    const now = context.currentTime;
    if (context.state !== 'running') {
      this.issue('Audio context suspended; user activation required');
      this.pause();
      return;
    }
    this.playing = true;
    const master = Math.max(0, state.master ?? 1);
    this.master?.gain.setValueAtTime(master, now);
    const discontinuity =
      this.lastTime === undefined ||
      this.lastEpoch !== state.epoch ||
      this.lastRate !== rate ||
      Math.abs(
        time - (this.lastTime + (now - this.lastContextTime) * this.lastRate),
      ) >
        1 / 30;
    if (discontinuity) {
      for (const id of this.voices.keys()) this.remove(id);
      this.clearBlips();
    }
    this.lastTime = time;
    this.lastEpoch = state.epoch;
    this.lastContextTime = now;
    this.lastRate = rate;
    const available = clips.filter(
      (clip) =>
        (clip.kind === 'audio' || clip.kind === 'video') &&
        clip.start + clip.duration > time &&
        clip.start <= time + 1.5 &&
        audible(clip, tracks),
    );
    const voiceActive = available.some(
      (clip) =>
        clip.audioRole === 'voice' &&
        clip.start <= time &&
        (clip.kind === 'video'
          ? elements.has(clip.id)
          : !!(
              clip.assetId &&
              this.buffers.has(clip.assetId) &&
              sourceTime(clip, time) <
                (this.buffers.get(clip.assetId)?.duration ?? 0)
            )) &&
        volumeAt(clip, time - clip.start) > 0,
    );
    const desired = new Set(available.map((clip) => clip.id));
    for (const id of this.voices.keys()) if (!desired.has(id)) this.remove(id);
    for (const clip of available) {
      const element = elements.get(clip.id);
      const buffer = clip.assetId ? this.buffers.get(clip.assetId) : undefined;
      // Video audio is ONLY from the element. No invented decoded extraction.
      if (clip.kind === 'video' && (!element || clip.start > time)) continue;
      if (clip.kind === 'audio' && !buffer) {
        this.issue(`Audio buffer unavailable: ${clip.assetId ?? clip.id}`);
        continue;
      }
      const signature = JSON.stringify([
        clip.assetId,
        clip.assetId ? this.bufferVersions.get(clip.assetId) : undefined,
        clip.start,
        clip.duration,
        clip.in,
        clip.speed,
        clip.keyframes,
        clip.volume,
        clip.animationOffsetSec,
        clip.fadeInSec,
        clip.fadeOutSec,
        clip.keepPitch,
      ]);
      let voice = this.voices.get(clip.id);
      if (
        voice &&
        (voice.signature !== signature || voice.element !== element)
      ) {
        this.remove(clip.id);
        voice = undefined;
      }
      if (!voice) {
        const gain = context.createGain();
        const duck = context.createGain();
        gain.connect(duck);
        duck.connect(this.master ?? context.destination);
        voice = {
          gain,
          duck,
          signature,
          duckFrom: 1,
          duckTo: 1,
          duckStart: now,
        };
        this.voices.set(clip.id, voice);
        if (clip.kind === 'video' && element) {
          let sources = elementSources.get(context);
          if (!sources) {
            sources = new WeakMap();
            elementSources.set(context, sources);
          }
          let source = sources.get(element);
          try {
            if (!source) {
              source = context.createMediaElementSource(element);
              sources.set(element, source);
            }
            source.connect(gain);
            voice.mediaSource = source;
            voice.element = element;
            element.muted = false;
            element.preservesPitch = clip.keepPitch ?? false;
          } catch (error) {
            this.issue(
              `Video audio unavailable: ${error instanceof Error ? error.message : 'source failed'}`,
            );
            this.remove(clip.id);
            continue;
          }
        } else if (buffer) {
          if (clip.keepPitch && clip.speed * rate !== 1)
            this.issue(
              'Pitch-preserving buffered audio is unavailable; native video pitch control only',
            );
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.setValueAtTime(clip.speed * rate, now);
          source.connect(gain);
          const start = Math.max(time, clip.start);
          const offset = sourceTime(clip, start);
          const remaining = Math.min(
            (clip.start + clip.duration - start) * clip.speed,
            buffer.duration - offset,
          );
          if (remaining <= 0) {
            source.disconnect();
            this.remove(clip.id);
            continue;
          }
          voice.source = source;
          const scheduledVoice = voice;
          source.onended = () => {
            scheduledVoice.ended = true;
            source.disconnect();
          };
          source.start(now + (start - time) / rate, offset, remaining);
        }
      }
      this.envelope(voice, clip, time, rate, 1);
      this.duck(
        voice,
        clip.audioRole === 'music' &&
          clip.duckUnderVoice !== false &&
          voiceActive
          ? DUCK_GAIN
          : 1,
        now,
      );
    }
    this.active =
      master > 0 &&
      available.some(
        (clip) =>
          clip.start <= time &&
          this.voices.has(clip.id) &&
          !this.voices.get(clip.id)?.ended &&
          volumeAt(clip, time - clip.start) > 0,
      );
  }
  /** Buffer-only 60ms audition. Video needs an actually decoded/injected audio buffer. */
  scrub(
    clips: readonly MediaClip[],
    tracks: readonly MediaTrack[],
    time: number,
    enabled = true,
  ): boolean {
    this.pause();
    if (!enabled) return false;
    const context = this.getContext();
    if (context.state !== 'running') {
      this.issue('Scrub audio requires user activation');
      return false;
    }
    let played = false;
    for (const clip of clips) {
      if (
        (clip.kind !== 'audio' && clip.kind !== 'video') ||
        time < clip.start ||
        time >= clip.start + clip.duration ||
        !audible(clip, tracks)
      )
        continue;
      const buffer = clip.assetId ? this.buffers.get(clip.assetId) : undefined;
      if (!buffer) {
        if (clip.kind === 'video')
          this.issue(
            'Video scrub audio unavailable; no extracted audio buffer',
          );
        continue;
      }
      const offset = sourceTime(clip, time);
      const seconds = Math.min(
        SCRUB_SECONDS,
        (buffer.duration - offset) / clip.speed,
        clip.start + clip.duration - time,
      );
      if (seconds <= 0) continue;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.setValueAtTime(clip.speed, context.currentTime);
      const gain = context.createGain();
      gain.gain.setValueAtTime(
        volumeAt(clip, time - clip.start),
        context.currentTime,
      );
      source.connect(gain);
      gain.connect(this.master ?? context.destination);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        this.blips.delete(source);
      };
      this.blips.set(source, gain);
      source.start(context.currentTime, offset, seconds * clip.speed);
      played = true;
    }
    return played;
  }
  pause(): void {
    this.playing = false;
    this.samples?.fill(0);
    for (const id of this.voices.keys()) this.remove(id);
    this.clearBlips();
    this.lastTime = undefined;
    this.active = false;
  }
  dispose(): void {
    if (this.disposed) return;
    this.pause();
    this.disposed = true;
    this.master?.disconnect();
    this.analyser?.disconnect();
    this.samples = undefined;
    this.buffers.clear();
    this.bufferVersions.clear();
    for (const entry of this.loading.values()) entry.controller.abort();
    this.loading.clear();
    this.urls.clear();
    if (this.context && !this.options.context)
      void this.context.close().catch(() => {
        /* Context already closed. */
      });
  }
}
