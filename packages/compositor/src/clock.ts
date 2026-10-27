export interface ClockOptions {
  /** Monotonic milliseconds, like performance.now. */
  now?: () => number;
  /** Running audible AudioContext seconds, otherwise null. */
  audioTime?: () => number | null;
  duration?: number;
}
/** One anchored clock. It owns no animation loop. */
export class TimelineClock {
  private readonly now: () => number;
  private readonly audioTime: () => number | null;
  private anchor = 0;
  private wallAnchor = 0;
  private audioAnchor: number | null = null;
  private last = 0;
  private lastWall = 0;
  private activeAudio = false;
  private running = false;
  private speed = 1;
  private duration: number;
  private loops = 0;
  /** Pass to AudioEngine.sync epoch so even sub-frame loops restart buffers. */
  get loopRevision(): number {
    return this.loops;
  }
  private loop: { start: number; end: number } | null = null;
  constructor(options: ClockOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.audioTime = options.audioTime ?? (() => null);
    this.duration = options.duration ?? Infinity;
    if (Number.isNaN(this.duration) || this.duration < 0)
      throw new RangeError('Invalid duration');
    this.reanchor(0);
  }
  get playing(): boolean {
    return this.running;
  }
  get rate(): number {
    return this.speed;
  }
  get currentTime(): number {
    if (!this.running) return this.anchor;
    const audio = this.activeAudio ? this.audioTime() : null;
    // Preserve elapsed wall time at a clock-domain transition, never absolute epochs.
    const switched = (audio === null) !== (this.audioAnchor === null);
    const delta =
      audio !== null && this.audioAnchor !== null
        ? audio - this.audioAnchor
        : (this.now() - this.wallAnchor) / 1000;
    let value = switched
      ? this.last +
        (Math.max(0, this.now() - this.lastWall) / 1000) * this.speed
      : this.anchor + Math.max(0, delta) * this.speed;
    if (switched) {
      // Do not clamp before applying the loop modulo below.
      this.anchor = value;
      this.wallAnchor = this.now();
      this.audioAnchor = audio;
    }
    if (this.loop && value >= this.loop.end) {
      this.loops++;
      value =
        this.loop.start +
        ((value - this.loop.start) % (this.loop.end - this.loop.start));
      this.reanchor(value);
    } else if (value >= this.duration) {
      value = this.duration;
      this.running = false;
      this.reanchor(value);
    }
    this.last = value;
    this.lastWall = this.now();
    return value;
  }
  private reanchor(time: number): void {
    this.anchor = this.last = Math.max(0, Math.min(this.duration, time));
    this.wallAnchor = this.lastWall = this.now();
    this.audioAnchor = this.activeAudio ? this.audioTime() : null;
  }
  play(): void {
    if (!this.running) {
      this.reanchor(this.anchor);
      this.running = true;
    }
  }
  pause(): void {
    const time = this.currentTime;
    this.running = false;
    this.reanchor(time);
  }
  seek(time: number): void {
    if (!Number.isFinite(time)) throw new RangeError('Invalid timeline time');
    this.reanchor(
      this.loop && (time < this.loop.start || time >= this.loop.end)
        ? this.loop.start
        : time,
    );
  }
  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 2)
      throw new RangeError('Transport rate must be 0.5 to 2');
    const time = this.currentTime;
    this.speed = rate;
    this.reanchor(time);
  }
  setAudioActive(active: boolean): void {
    const time = this.currentTime;
    this.activeAudio = active;
    this.reanchor(time);
  }
  setDuration(duration: number): void {
    if (!Number.isFinite(duration) || duration < 0)
      throw new RangeError('Invalid duration');
    const time = this.currentTime;
    this.duration = duration;
    if (this.loop && this.loop.end > duration) this.loop = null;
    this.reanchor(time);
  }
  /** Both null means whole-project loop; one unset endpoint is invalid. */
  setLoop(
    enabled: boolean,
    start: number | null = null,
    end: number | null = null,
  ): void {
    const time = this.currentTime;
    if (!enabled) this.loop = null;
    else {
      const a = start ?? 0;
      const b = end ?? this.duration;
      if (
        (start === null) !== (end === null) ||
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        a < 0 ||
        b <= a ||
        b > this.duration
      )
        throw new RangeError('Invalid I/O loop');
      this.loop = { start: a, end: b };
    }
    this.reanchor(
      this.loop && (time < this.loop.start || time >= this.loop.end)
        ? this.loop.start
        : time,
    );
  }
}
