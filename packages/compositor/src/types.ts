import type { Asset, Clip, KimoProject } from '@kimo/client';

/** Pure values only. Track array is bottom-to-top; layers are source-over. */
export interface Approximation {
  clipId: string;
  reason: string;
}
export interface ResolvedTransition {
  kind: NonNullable<Clip['transitionIn']>['kind'];
  phase: 'in' | 'out';
  progress: number;
  durationSec: number;
  direction: 'left' | 'right' | 'up' | 'down';
  blurPx: number;
}
export interface ResolvedMask {
  assetId: string;
  invert: boolean;
  feather: number;
  mode: 'selection' | 'cutout';
  sourceTime: number;
  frameIndex?: number;
  metadata?: Asset['mask'];
}
export interface ResolvedEffect {
  id: string;
  kind: string;
  scope: 'all' | 'inside_mask' | 'outside_mask';
  params: Clip['effects'][number]['params'];
}
export interface ResolvedText {
  content: string;
  secondaryContent: string;
  styleId: string;
  style: import('./text-styles').TextStyle;
  safeRect: { x: number; y: number; width: number; height: number };
  anchor: { x: number; y: number };
  scale: number;
  verticalAnchor?: 'top';
  words: { text: string; start: number; end: number; active: boolean }[];
}
export interface ResolvedTransitionPair {
  id: string;
  trackId: string;
  kind: NonNullable<Clip['transitionIn']>['kind'];
  outgoingClipId: string;
  incomingClipId: string;
  /** Composite once at incoming layer's z slot; do not draw the members again. */
  compositeAtClipId: string;
  boundary: number;
  start: number;
  end: number;
  progress: number;
  durationSec: number;
  direction: 'left' | 'right' | 'up' | 'down';
  /** mix = weighted premultiplied RGBA sum then ONE source-over operation. */
  composite: 'premultiplied_mix' | 'source_over';
  outgoingWeight: number;
  incomingWeight: number;
  /** Opaque black premultiplied sample weight, nonzero only for dip. */
  blackWeight: number;
}
export interface TransitionSample {
  mode: 'handle' | 'boundary';
  requestedSourceTime: number;
  sampleTimelineTime: number;
  boundary?: 'start' | 'end';
}
export interface ResolvedLayer {
  clipId: string;
  trackId: string;
  kind: Clip['kind'];
  assetId?: string;
  sourceTime: number;
  localTime: number;
  animationTime: number;
  transform: Clip['transform'];
  opacity: number;
  crop?: Clip['transform']['crop'];
  effects: ResolvedEffect[];
  mask?: ResolvedMask;
  text?: ResolvedText;
  shape?: Clip['shape'];
  transitions: ResolvedTransition[];
  transitionPairId?: string;
  transitionRole?: 'outgoing' | 'incoming';
  /** Explicit transition-only media sample, never an extension of the project clip. */
  transitionSample?: TransitionSample;
  approximations: string[];
}
export interface ResolvedAudio {
  clipId: string;
  trackId: string;
  assetId?: string;
  sourceTime: number;
  playbackRate: number;
  role: 'voice' | 'music' | 'other';
  gain: number;
  duckGain: number;
  muted: boolean;
}
export interface SceneGraph {
  time: number;
  frame: number;
  width: number;
  height: number;
  fps: KimoProject['fps'];
  /** Normalized project clear/composite colour, not an editor UI colour. */
  background?: [number, number, number, number];
  layers: ResolvedLayer[];
  /** Transient transparent pair placeholders, never text pixels or persisted state. */
  excludedTextPairs?: { layer: ResolvedLayer; index: number }[];
  /** Optional for legacy synthetic scenes; builder always supplies an array. */
  transitionPairs?: ResolvedTransitionPair[];
  audio: ResolvedAudio[];
  approximations: Approximation[];
}
export interface SceneBuildOptions {
  /** Resource metadata is injected, never fetched. */
  assets?: Readonly<Record<string, Asset>>;
  masterVolume?: number;
  /** Explicit source fps for endpoint freeze; project fps is fallback, not source-frame proof. */
  sourceFps?: Readonly<Record<string, number>>;
}
