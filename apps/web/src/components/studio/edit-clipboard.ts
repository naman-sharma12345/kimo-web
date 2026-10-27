import type { Asset, KimoProject, Op } from '@kimo/client';
import {
  duplicateClips,
  trackAccepts,
  validateCommands,
} from '@/lib/editing/commands';
export interface ClipClipboard {
  project: KimoProject;
  ids: readonly string[];
}
/** Browser-session-only copy, never overwrites the user's system clipboard. */
export function copyClips(
  project: KimoProject,
  ids: readonly string[],
): ClipClipboard | null {
  const selected = [...new Set(ids)].filter((id) => !!project.clips[id]);
  return selected.length
    ? { project: structuredClone(project), ids: selected }
    : null;
}
export function pasteClips(
  current: KimoProject,
  clipboard: ClipClipboard,
  at: number,
  assets: readonly Asset[] = [],
  makeId = () => crypto.randomUUID(),
): Op[] {
  if (!Number.isFinite(at)) throw new Error('invalid paste position');
  const starts = clipboard.ids
    .map((id) => clipboard.project.clips[id]?.start)
    .filter((start): start is number => start !== undefined);
  if (!starts.length) return [];
  const copies = duplicateClips(
    clipboard.project,
    clipboard.ids,
    makeId,
    Math.max(0, at) - Math.min(...starts),
  );
  const ops = copies.map((op) => {
    if (op.op !== 'clip.add')
      throw new Error('clipboard contains a non-add operation');
    const sourceTrack = clipboard.project.tracks.find(
      (track) => track.id === op.clip.trackId,
    );
    const track =
      current.tracks.find(
        (track) =>
          track.id === op.clip.trackId &&
          !track.locked &&
          trackAccepts(track, op.clip),
      ) ??
      current.tracks.find(
        (track) =>
          !track.locked &&
          track.kind === sourceTrack?.kind &&
          trackAccepts(track, op.clip),
      );
    if (!track) throw new Error('no unlocked compatible track for pasted clip');
    return { op: 'clip.add' as const, clip: { ...op.clip, trackId: track.id } };
  });
  return validateCommands(current, ops, assets);
}
