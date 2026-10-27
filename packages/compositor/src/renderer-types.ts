import type { Approximation, SceneGraph } from './types';
export interface RendererResourceRequest {
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
export interface RenderResult {
  submitted: boolean;
  retained: boolean;
  approximations: Approximation[];
}
export interface SceneRenderer {
  init(options: RendererInit): Promise<void>;
  resize(width: number, height: number, resolution?: number): void;
  render(scene: SceneGraph): Promise<RenderResult>;
  /** Cancels deferred resource/font work while retaining the last good frame. */
  cancelPending?(): void;
  destroy(): void;
}
