export interface RenderFrame {
  frame: number;
  url: string;
}
export interface FrameResources {
  fetch: typeof fetch;
  create: (blob: Blob) => string;
  revoke: (url: string) => void;
  decode: (url: string) => Promise<void>;
}
export const browserFrames: FrameResources = {
  fetch: (...args) => fetch(...args),
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
  decode: async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
  },
};
/** One pending fetch/decode and eight retained URLs. No invented intermediate frames. */
export class RenderFrames {
  private frames: RenderFrame[] = [];
  private generation = 0;
  private requested = -1;
  private pending?: AbortController;
  private disposed = false;
  private candidates = new Set<string>();
  constructor(
    private resources: FrameResources,
    private observe: (frames: readonly RenderFrame[]) => void,
  ) {}
  async advance(frame: number, href: string): Promise<void> {
    if (
      this.disposed ||
      !Number.isSafeInteger(frame) ||
      frame <= 0 ||
      frame <= this.requested
    )
      return;
    this.requested = frame;
    const generation = ++this.generation;
    this.pending?.abort();
    for (const url of this.candidates) this.resources.revoke(url);
    this.candidates.clear();
    const pending = new AbortController();
    this.pending = pending;
    let url: string | undefined;
    try {
      const response = await this.resources.fetch(href, {
        signal: pending.signal,
      });
      if (
        !response.ok ||
        !response.headers.get('content-type')?.startsWith('image/jpeg')
      )
        throw new Error('Preview frame unavailable');
      const blob = await response.blob();
      if (this.disposed || generation !== this.generation) return;
      if (this.frames.length === 8) {
        const old = this.frames.shift();
        if (old) this.resources.revoke(old.url);
        this.observe([...this.frames]);
      }
      url = this.resources.create(blob);
      this.candidates.add(url);
      await this.resources.decode(url);
      if (this.disposed || generation !== this.generation) return;
      this.frames.push({ frame, url });
      this.candidates.delete(url);
      url = undefined;
      this.observe([...this.frames]);
    } catch {
      // A missing illustrative frame must not overwrite the last successfully decoded frame.
      if (generation === this.generation)
        this.requested = this.frames.at(-1)?.frame ?? -1;
    } finally {
      if (url && this.candidates.delete(url)) this.resources.revoke(url);
    }
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.pending?.abort();
    for (const frame of this.frames) this.resources.revoke(frame.url);
    for (const url of this.candidates) this.resources.revoke(url);
    this.candidates.clear();
    this.frames = [];
  }
}
