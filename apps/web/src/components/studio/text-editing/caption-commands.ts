import { applyOps, type Clip, type KimoProject, type Op } from '@kimo/client';
import { splitClips, trimClip, validateCommands } from '@/lib/editing/commands';
import { textUpdate } from '@/lib/editing/text';

export const CAPTION_STYLES = [
  'caption-clean',
  'caption-pop',
  'caption-box',
] as const;
export const TEXT_STYLE_IDS = [
  ...CAPTION_STYLES,
  'title-serif',
  'title-bold',
  'lower-third',
  'label-mono',
  'quote',
] as const;
export type TextStyleFields = Pick<
  NonNullable<Clip['text']>,
  'style' | 'fontSize' | 'alignment' | 'color' | 'animation' | 'position'
>;
export const TEXT_ANIMATIONS: readonly NonNullable<
  Clip['text']
>['animation'][] = ['none', 'fade', 'rise', 'type on', 'pop words'];
export function isCaptionClip(clip: Clip) {
  return (
    clip.kind === 'text' &&
    !!clip.text &&
    (clip.text.style === 'caption' ||
      CAPTION_STYLES.some((style) => style === clip.text?.style))
  );
}
export function captionClips(project: KimoProject, trackId?: string) {
  return Object.values(project.clips)
    .filter(
      (clip) => isCaptionClip(clip) && (!trackId || clip.trackId === trackId),
    )
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
/** Literal, Unicode-safe substring replacement; no regex or invented word alignment. */
export function replaceCaptions(
  project: KimoProject,
  ids: readonly string[],
  find: string,
  replace: string,
): Op[] {
  if (!find) return [];
  return validateCommands(
    project,
    ids.flatMap((id) => {
      const clip = project.clips[id];
      if (
        !clip?.text ||
        !isCaptionClip(clip) ||
        !clip.text.content.includes(find)
      )
        return [];
      return [
        textUpdate(
          clip,
          clip.text.content.split(find).join(replace),
          clip.text.secondaryContent,
        ),
      ];
    }),
  );
}
export function styleCaptions(
  project: KimoProject,
  ids: readonly string[],
  patch: Partial<TextStyleFields>,
): Op[] {
  return validateCommands(
    project,
    ids.flatMap((id): Op[] => {
      const clip = project.clips[id];
      return clip?.text && isCaptionClip(clip)
        ? [
            {
              op: 'clip.update',
              id,
              patch: { text: { ...clip.text, ...patch } },
            },
          ]
        : [];
    }),
  );
}
/** Retime through the core trim validator, preserving animation-clock timing fields. */
export function retimeCaption(
  project: KimoProject,
  id: string,
  edge: 'in' | 'out',
  timelineTime: number,
): Op[] {
  const clip = project.clips[id];
  if (!clip || !isCaptionClip(clip)) throw new Error('Select a caption');
  return trimClip(
    project,
    id,
    edge,
    clip.in + (timelineTime - clip.start) * clip.speed,
  );
}
/** Split only on a word boundary supplied by the user; no claim of phonetic alignment. */
export function splitCaption(
  project: KimoProject,
  id: string,
  at: number,
  wordIndex: number,
  newId: string,
): Op[] {
  const clip = project.clips[id];
  if (!clip?.text || !isCaptionClip(clip)) throw new Error('Select a caption');
  const words = clip.text.content.trim().split(/\s+/u).filter(Boolean);
  if (
    !Number.isInteger(wordIndex) ||
    wordIndex <= 0 ||
    wordIndex >= words.length
  )
    throw new Error('Choose an interior word boundary');
  const split = splitClips(project, [id], at, () => newId);
  if (!split.length) return [];
  const next = applyOps(project, split, project.version);
  const left = next.clips[id],
    right = next.clips[newId];
  if (!left?.text || !right?.text) return [];
  const previous = clip.text.words;
  const timed = previous?.length === words.length;
  const leftOp = textUpdate(left, words.slice(0, wordIndex).join(' '));
  const rightOp = textUpdate(right, words.slice(wordIndex).join(' '));
  if (timed) {
    leftOp.words = previous.slice(0, wordIndex);
    rightOp.words = previous.slice(wordIndex);
  }
  return validateCommands(project, [...split, leftOp, rightOp]);
}
/** Adjacent same-track/style captions only. Shift right timing to left's animation clock. */
export function joinCaptions(
  project: KimoProject,
  leftId: string,
  rightId: string,
): Op[] {
  const left = project.clips[leftId],
    right = project.clips[rightId];
  if (
    !left?.text ||
    !right?.text ||
    !isCaptionClip(left) ||
    !isCaptionClip(right) ||
    left.trackId !== right.trackId ||
    left.text.style !== right.text.style ||
    Math.abs(left.start + left.duration - right.start) > 1 / project.fps / 2
  )
    throw new Error('Choose adjacent captions of the same style');
  const duration = left.duration + right.duration;
  const content = [left.text.content.trim(), right.text.content.trim()]
    .filter(Boolean)
    .join(' ');
  const op = textUpdate(
    { ...left, duration },
    content,
    left.text.secondaryContent,
  );
  if (left.text.words && right.text.words) {
    const shift =
      (left.animationOffsetSec ?? 0) +
      left.duration -
      (right.animationOffsetSec ?? 0);
    op.words = [
      ...left.text.words,
      ...right.text.words.map((word) => ({ ...word, t: word.t + shift })),
    ];
  }
  return validateCommands(project, [
    { op: 'clip.update', id: leftId, patch: { duration } },
    op,
    { op: 'clip.remove', id: rightId },
  ]);
}
export function captionTime(time: number, fps = 30) {
  const frames = Math.max(0, Math.round(time * fps));
  return `${String(Math.floor(frames / fps / 60)).padStart(2, '0')}:${String(Math.floor(frames / fps) % 60).padStart(2, '0')}:${String(frames % fps).padStart(2, '0')}`;
}
