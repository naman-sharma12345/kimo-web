import type { Approximation, SceneGraph } from './types';
/** Presentation branch only; persisted project/clip identities remain unchanged. */
export type RendererBranch = 'current' | 'historical';
export interface ComparisonFrame {
  current: SceneGraph;
  historical: SceneGraph;
  /** Viewport-space wipe position, finite and clamped to 0..1 by the caller. */
  split: number;
}
export interface RendererResourceRequest {
  branch?: RendererBranch;
  clipId: string;
  assetId: string;
  sourceTime: number;
  role: 'media' | 'mask' | 'lut';
  frameIndex?: number;
}
export interface PixelResource {
  /** Row-major premultiplied RGBA8. RLE helper emits this format. */
  data: Uint8Array;
  width: number;
  height: number;
}
export interface PreparedRendererResource {
  /** Stable resource identity. A video element may reuse this key across prepared times. */
  key: string;
  /** Optional explicit content revision for mutable buffers/canvases or video frames. */
  revision?: string | number;
  source:
    | HTMLVideoElement
    | ImageBitmap
    | HTMLImageElement
    | HTMLCanvasElement
    | OffscreenCanvas
    | PixelResource;
  width: number;
  height: number;
  /** Releases the acquired lease, never called twice. Pool owns close/pause/src. */
  release?: () => void;
  /** Supplied when media acceptance used a degraded seek or frozen frame. */
  approximation?: string;
}
export interface RendererOptions {
  getResource?: (
    request: RendererResourceRequest,
  ) => PreparedRendererResource | undefined;
  /** Injectable font loader for deterministic tests. False explicitly reports fallback. */
  loadFont?: (css: string, text: string) => Promise<boolean>;
}
export interface RendererInit {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  resolution?: number;
}
export interface FrameCapture {
  blob: Blob;
  width: number;
  height: number;
}
export interface RenderOptions {
  capture?: boolean;
  signal?: AbortSignal;
}
export interface RenderResult {
  frame?: FrameCapture;
  submitted: boolean;
  retained: boolean;
  approximations: Approximation[];
}
export interface SceneRenderer {
  init(options: RendererInit): Promise<void>;
  resize(width: number, height: number, resolution?: number): void;
  render(scene: SceneGraph, options?: RenderOptions): Promise<RenderResult>;
  /** Optional dual-scene submission in the SAME renderer/context, with one presentation. */
  renderComparison?(
    frame: ComparisonFrame,
    options?: RenderOptions,
  ): Promise<RenderResult>;
  /** Cancels deferred resource/font work while retaining the last good frame. */
  cancelPending?(): void;
  destroy(): void;
}
