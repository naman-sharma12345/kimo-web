/** Structural boundary: compatible with both legacy and additive client contracts. */
export interface MediaAsset {
  id: string;
  url: string;
  proxyUrl?: string;
  durationSec?: number;
  source?: string;
}
export interface MediaClip {
  id: string;
  assetId?: string;
  trackId: string;
  kind: string;
  start: number;
  duration: number;
  in: number;
  speed: number;
  volume?: number;
  audioRole?: 'voice' | 'music' | 'other';
  animationOffsetSec?: number;
  keyframes?: readonly {
    property: string;
    time: number;
    value: number;
    easing?: string;
    bezier?: readonly number[];
  }[];
}
export interface MediaTrack {
  id: string;
  muted: boolean;
  solo?: boolean;
}
/** Explicit encoded-media clock; rate is media seconds per timeline second, before transport. */
export interface MediaSourceTiming {
  timelineTime: number;
  mediaTime: number;
  rate: number;
}
export interface VideoRequest {
  clipId: string;
  asset: MediaAsset;
  start: number;
  duration: number;
  in: number;
  speed: number;
  purpose?: 'video' | 'mask';
  sourceTiming?: MediaSourceTiming;
}
export interface MediaFrame {
  element: HTMLVideoElement;
  sourceTime: number;
  exact: boolean;
  reason?: string;
}
export interface MediaSyncResult {
  frames: Map<string, MediaFrame>;
  issues: string[];
}
export function abortError(): DOMException {
  return new DOMException('Media operation cancelled', 'AbortError');
}
export function sourceTime(
  clip: Pick<MediaClip, 'in' | 'start' | 'speed'>,
  time: number,
): number {
  return Math.max(0, clip.in + (time - clip.start) * clip.speed);
}
export function audible(
  clip: MediaClip,
  tracks: readonly MediaTrack[],
): boolean {
  const track = tracks.find((entry) => entry.id === clip.trackId);
  return (
    !track?.muted &&
    (!tracks.some((entry) => entry.solo && !entry.muted) ||
      track?.solo === true)
  );
}
