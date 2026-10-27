import type { Asset, Clip, KimoProject, Track } from '@kimo/client';
export const track = (id = 'v', kind: Track['kind'] = 'video'): Track => ({
  id,
  kind,
  name: kind === 'video' ? 'V1' : kind,
  height: kind === 'video' ? 88 : kind === 'text' ? 48 : 64,
  muted: false,
  hidden: false,
  locked: false,
});
export const clip = (id = 'a', patch: Partial<Clip> = {}): Clip => ({
  id,
  trackId: 'v',
  kind: 'video',
  assetId: 'source',
  start: 4,
  duration: 3,
  in: 2,
  speed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  effects: [],
  keyframes: [],
  ...patch,
});
export const source: Asset = {
  id: 'source',
  kind: 'video',
  name: 'beach_02',
  url: '/beach.mp4',
  source: 'user',
  durationSec: 30,
};
export const project = (
  clips: Clip[] = [clip()],
  tracks: Track[] = [track()],
): KimoProject => ({
  id: 'p',
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: Math.max(10, ...clips.map((c) => c.start + c.duration)),
  tracks,
  clips: Object.fromEntries(clips.map((c) => [c.id, c])),
  markers: [{ id: 'mark', time: 8, label: 'beat' }],
});
