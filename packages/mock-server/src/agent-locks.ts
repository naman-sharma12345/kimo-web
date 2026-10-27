import type { KimoProject, Op } from '@kimo/client';
/** Synthetic producer enforcement only, not evidence of production-engine lock agreement. */
export function targetsLockedEntity(
  project: KimoProject,
  ops: readonly Op[],
): boolean {
  return ops.some((op) => {
    const clipId =
      op.op === 'clip.add'
        ? op.clip.id
        : 'clipId' in op
          ? op.clipId
          : op.op.startsWith('clip.') && 'id' in op
            ? op.id
            : undefined;
    const clip = clipId ? project.clips[clipId] : undefined;
    if (
      clip?.locked ||
      project.tracks.find((track) => track.id === clip?.trackId)?.locked
    )
      return true;
    const trackId =
      op.op === 'clip.add'
        ? op.clip.trackId
        : op.op === 'clip.move'
          ? op.trackId
          : op.op === 'clip.update'
            ? op.patch.trackId
            : op.op === 'track.update' || op.op === 'track.remove'
              ? op.id
              : undefined;
    return !!(
      trackId && project.tracks.find((track) => track.id === trackId)?.locked
    );
  });
}
