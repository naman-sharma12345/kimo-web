import type { Clip, Op } from '@kimo/client';
/** Words use the stable animation clock, not source time or global timeline time. */
export function textUpdate(
  clip: Clip,
  content: string,
  secondaryContent?: string,
): Extract<Op, { op: 'text.update' }> {
  if (!clip.text || clip.kind !== 'text') throw new Error('Select a text clip');
  const tokens = content.trim() ? content.trim().split(/\s+/u) : [];
  const previous = clip.text.words;
  const words =
    previous?.length === tokens.length
      ? previous.map((word, index) => ({ ...word, w: tokens[index] ?? '' }))
      : tokens.map((w, index) => ({
          w,
          t:
            (clip.animationOffsetSec ?? 0) +
            (index * clip.duration) / tokens.length,
          d: clip.duration / tokens.length,
        }));
  return {
    op: 'text.update',
    clipId: clip.id,
    content,
    words,
    ...(secondaryContent === undefined ? {} : { secondaryContent }),
  };
}
