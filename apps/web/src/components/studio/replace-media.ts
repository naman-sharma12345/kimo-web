import type { Asset, KimoProject, Op } from '@kimo/client';
import { validateCommands } from '@/lib/editing/commands';
/** Preserve placement/style, clamp to verified source headroom and discard source-specific masks. */
export function replaceMedia(
  project: KimoProject,
  clipId: string,
  asset: Asset,
  assets: readonly Asset[],
): Op[] {
  const current = project.clips[clipId];
  if (
    !current ||
    !['video', 'audio', 'image'].includes(current.kind) ||
    asset.kind !== current.kind ||
    asset.mask ||
    asset.lut
  )
    throw new Error('choose replacement media of the same kind');
  const clip = structuredClone(current);
  clip.assetId = asset.id;
  delete clip.mask;
  if (clip.kind !== 'image') {
    if (asset.durationSec === undefined)
      throw new Error('replacement source duration is not available');
    const frameSource = clip.speed / project.fps;
    if (asset.durationSec < frameSource)
      throw new Error('replacement source is shorter than one frame');
    clip.in = Math.max(0, Math.min(clip.in, asset.durationSec - frameSource));
    clip.duration = Math.max(
      1 / project.fps,
      Math.floor(
        (Math.min(clip.duration, (asset.durationSec - clip.in) / clip.speed) +
          1e-8) *
          project.fps,
      ) / project.fps,
    );
    if (clip.fadeInSec !== undefined)
      clip.fadeInSec = Math.min(clip.fadeInSec, clip.duration);
    if (clip.fadeOutSec !== undefined)
      clip.fadeOutSec = Math.min(clip.fadeOutSec, clip.duration);
  }
  return validateCommands(
    project,
    [
      { op: 'clip.remove', id: clipId },
      { op: 'clip.add', clip },
    ],
    assets,
  );
}
