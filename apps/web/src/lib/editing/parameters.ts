/** Pure inspector contract mirrored from established compositor filter ranges.
 * No GPU imports. These are supported numeric bounds, not a new UI slider design.
 */
import { effectParameterBounds } from '@kimo/client';
export const gradeRanges = effectParameterBounds.grade ?? {};
export function dbToGain(db: number): number {
  if (!Number.isFinite(db) || db < -60 || db > 12)
    throw new Error('Volume must be between -60 and +12 dB');
  return 10 ** (db / 20);
}
export function gainToDb(gain: number): number {
  if (!Number.isFinite(gain) || gain < 0)
    throw new Error('Gain must be finite and nonnegative');
  return Math.max(-60, 20 * Math.log10(gain));
}
export function animationTime(
  clip: { start: number; animationOffsetSec?: number },
  playhead: number,
): number {
  return Math.max(0, playhead - clip.start + (clip.animationOffsetSec ?? 0));
}
