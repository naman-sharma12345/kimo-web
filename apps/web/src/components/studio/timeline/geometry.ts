import type { TimelineBeat } from './types';
import type { Clip, KimoProject, Track } from '@kimo/client';
export const HEADER_WIDTH = 160;
export const RULER_HEIGHT = 28;
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 600;
export const clampZoom = (value: number) =>
  Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, Number.isFinite(value) ? value : MIN_ZOOM),
  );
export const fitZoom = (width: number, duration: number) =>
  clampZoom(Math.max(0, width - HEADER_WIDTH) / Math.max(duration * 1.1, 1));
export const rowHeight = (kind: Track['kind']) =>
  kind === 'text' ? 48 : kind === 'video' ? 88 : 64;
export function viewportRange(scroll: number, width: number, zoom: number) {
  return {
    start: Math.max(0, (scroll - width) / zoom),
    end: (scroll + width * 2) / zoom,
  };
}
export function visibleClips(
  clips: readonly Clip[],
  scroll: number,
  width: number,
  zoom: number,
): Clip[] {
  const range = viewportRange(scroll, width, zoom);
  return clips.filter(
    (c) => c.start + c.duration >= range.start && c.start <= range.end,
  );
}
export function canvasBounds(width: number, dpr: number) {
  const ratio = Math.min(2, Math.max(1, dpr || 1));
  return { width: Math.ceil(Math.max(1, width) * 3), ratio };
}
export const timecode = (time: number) =>
  `${Math.floor(Math.max(0, time) / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(Math.max(0, time) % 60)
    .toString()
    .padStart(2, '0')}`;
export function majorInterval(zoom: number): number {
  return (
    [1, 2, 5, 10, 30, 60].find((value) => value * zoom >= 80) ??
    Math.ceil(80 / zoom / 60) * 60
  );
}
export function hitClip(
  clips: readonly Clip[],
  time: number,
): Clip | undefined {
  return [...clips]
    .reverse()
    .find((c) => time >= c.start && time < c.start + c.duration);
}
export function edgeAt(
  clip: Clip,
  time: number,
  zoom: number,
): 'in' | 'out' | null {
  const a = Math.abs(time - clip.start) * zoom;
  const b = Math.abs(time - clip.start - clip.duration) * zoom;
  return Math.min(a, b) <= 8 + 1e-9 ? (a <= b ? 'in' : 'out') : null;
}
export function selectClip(
  current: readonly string[],
  id: string,
  additive: boolean,
): string[] {
  return additive
    ? current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]
    : [id];
}
export function linkedSelection(
  project: KimoProject,
  ids: readonly string[],
  linked: boolean,
): string[] {
  if (!linked) return [...ids];
  const groups = new Set(
    ids.map((id) => project.clips[id]?.linkGroupId).filter(Boolean),
  );
  return [
    ...new Set([
      ...ids,
      ...Object.values(project.clips)
        .filter((c) => c.linkGroupId && groups.has(c.linkGroupId))
        .map((c) => c.id),
    ]),
  ];
}
/** Validate supplied project-clock beats against the current clip identity and visible span. */
export function validTimelineBeats(
  project: KimoProject,
  beats: readonly TimelineBeat[] = [],
  excluded: readonly string[] = [],
): TimelineBeat[] {
  const moving = new Set(excluded);
  const seen = new Set<string>();
  return beats.filter((beat) => {
    const clip = project.clips[beat.clipId];
    const track = project.tracks.find((item) => item.id === beat.trackId);
    if (
      !clip ||
      !track ||
      track.hidden ||
      moving.has(clip.id) ||
      clip.trackId !== beat.trackId ||
      clip.audioRole !== 'music' ||
      !['audio', 'video'].includes(clip.kind) ||
      !Number.isFinite(beat.time) ||
      beat.time < clip.start ||
      beat.time >= clip.start + clip.duration
    )
      return false;
    const identity = JSON.stringify([beat.trackId, beat.time]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
export function snapTime(
  project: KimoProject,
  value: number,
  zoom: number,
  moving: readonly string[],
  playhead: number,
  beats: readonly TimelineBeat[] = [],
): { time: number; guide?: number } {
  const exclude = new Set(moving);
  const candidates = [
    playhead,
    ...validTimelineBeats(project, beats, moving).map((beat) => beat.time),
    ...project.markers.map((m) => m.time),
    ...Object.values(project.clips)
      .filter((c) => !exclude.has(c.id))
      .flatMap((c) => [c.start, c.start + c.duration]),
  ];
  const sorted = [...new Set(candidates)].sort(
    (a, b) => Math.abs(a - value) - Math.abs(b - value) || a - b,
  );
  const target = sorted[0];
  return target !== undefined && Math.abs(target - value) <= 8 / zoom + 1e-9
    ? { time: target, guide: target }
    : { time: value };
}
export function snapDelta(
  project: KimoProject,
  ids: readonly string[],
  delta: number,
  zoom: number,
  playhead: number,
  beats: readonly TimelineBeat[] = [],
): { delta: number; guide?: number } {
  const choices = ids
    .flatMap((id) => {
      const c = project.clips[id];
      return c
        ? [c.start, c.start + c.duration].map((edge) => {
            const snap = snapTime(
              project,
              edge + delta,
              zoom,
              ids,
              playhead,
              beats,
            );
            return { delta: snap.time - edge, guide: snap.guide };
          })
        : [];
    })
    .filter((choice) => choice.guide !== undefined)
    .sort(
      (a, b) =>
        Math.abs(a.delta - delta) - Math.abs(b.delta - delta) ||
        (a.guide ?? 0) - (b.guide ?? 0),
    );
  return choices[0] ?? { delta };
}
export const sourceClock = (
  clip: Pick<Clip, 'start' | 'in' | 'speed'>,
  timeline: number,
) => clip.in + (timeline - clip.start) * clip.speed;
