import type { Clip, Transition } from '@kimo/client';
export function transitionChips(
  clips: readonly Clip[],
  fps: number,
): { clipId: string; at: number; label: string }[] {
  const cuts = new Map<
    number,
    { clipId: string; at: number; transition: Transition }
  >();
  const frame = (time: number) => Math.round(time * fps);
  // Incoming declaration takes precedence, matching compositor pair semantics.
  for (const c of clips)
    if (c.transitionOut && c.transitionOut.kind !== 'cut')
      cuts.set(frame(c.start + c.duration), {
        clipId: c.id,
        at: c.start + c.duration,
        transition: c.transitionOut,
      });
  for (const c of clips)
    if (c.transitionIn && c.transitionIn.kind !== 'cut')
      cuts.set(frame(c.start), {
        clipId: c.id,
        at: c.start,
        transition: c.transitionIn,
      });
  return [...cuts.values()]
    .sort((a, b) => a.at - b.at)
    .map(({ clipId, at, transition }) => ({
      clipId,
      at,
      label: `${transition.kind === 'crossfade' ? 'cross dissolve' : transition.kind.replaceAll('_', ' ')} · ${transition.durationFrames ?? Math.round((transition.duration ?? 0) * fps)}f`,
    }));
}
