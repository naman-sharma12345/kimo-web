import { effectParameterBounds } from '@kimo/client';
import type { Clip, KimoProject, Op, Transition } from '@kimo/client';
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export const gainToDb = (gain: number) =>
  gain > 0 && Number.isFinite(gain)
    ? clamp(20 * Math.log10(gain), -60, 12)
    : -60;
export const dbToGain = (db: number) => 10 ** (clamp(db, -60, 12) / 20);
export const animationTime = (clip: Clip, playhead: number, fps: number) =>
  Math.max(
    0,
    Math.round((playhead - clip.start + (clip.animationOffsetSec ?? 0)) * fps) /
      fps,
  );
export function hasKey(
  clip: Clip,
  property: string,
  time: number,
  fps: number,
) {
  return clip.keyframes.some(
    (k) =>
      k.property.replace(/^transform\./, '') === property &&
      Math.abs(k.time - time) < 0.5 / fps,
  );
}
export function toggleKey(
  clip: Clip,
  property: keyof Omit<Clip['transform'], 'crop'>,
  playhead: number,
  fps: number,
): Op {
  const time = animationTime(clip, playhead, fps);
  const exists = hasKey(clip, property, time, fps);
  return {
    op: 'clip.update',
    id: clip.id,
    patch: {
      keyframes: exists
        ? clip.keyframes.filter(
            (k) =>
              !(
                k.property.replace(/^transform\./, '') === property &&
                Math.abs(k.time - time) < 0.5 / fps
              ),
          )
        : [
            ...clip.keyframes,
            {
              property,
              time,
              value: clip.transform[property],
              easing: 'linear',
            },
          ],
    },
  };
}
export function cropValue(
  clip: Clip,
  edge: keyof NonNullable<Clip['transform']['crop']>,
  percent: number,
  lock: boolean,
): Clip['transform'] {
  const crop = { ...(clip.transform.crop ?? { l: 0, t: 0, r: 0, b: 0 }) };
  const opposite = { l: 'r', r: 'l', t: 'b', b: 't' } as const;
  const other = opposite[edge];
  let value = clamp(percent / 100, 0, 0.999 - crop[other]);
  if (lock) {
    // Preserve the retained width/height ratio, hence the source crop aspect.
    const oldSpan = 1 - crop[edge] - crop[other];
    let newSpan = 1 - value - crop[other];
    const orthogonal =
      edge === 'l' || edge === 'r'
        ? (['t', 'b'] as const)
        : (['l', 'r'] as const);
    const retained = 1 - crop[orthogonal[0]] - crop[orthogonal[1]];
    newSpan = Math.min(newSpan, oldSpan / Math.max(0.001, retained));
    value = 1 - crop[other] - newSpan;
    const target = clamp(
      (retained * newSpan) / Math.max(0.001, oldSpan),
      0.001,
      1,
    );
    const sum = 1 - retained;
    const nextSum = 1 - target;
    crop[orthogonal[0]] =
      sum > 0 ? (nextSum * crop[orthogonal[0]]) / sum : nextSum / 2;
    crop[orthogonal[1]] = nextSum - crop[orthogonal[0]];
  }
  crop[edge] = value;
  return { ...clip.transform, crop };
}
export function transitionFrames(t: Transition | undefined, fps: number) {
  return Math.max(0, Math.round(t?.durationFrames ?? (t?.duration ?? 0) * fps));
}
export function makeTransition(
  t: Transition | undefined,
  patch: Partial<Transition>,
  fps: number,
): Transition {
  const frames = Math.max(
    0,
    Math.round(patch.durationFrames ?? transitionFrames(t, fps)),
  );
  return {
    ...t,
    kind: t?.kind ?? 'cut',
    ...patch,
    durationFrames: frames,
    duration: frames / fps,
  };
}
/** Set both declarations of an actual cut so incoming precedence cannot hide edits. */
export function transitionOps(
  project: KimoProject,
  clip: Clip,
  side: 'transitionIn' | 'transitionOut',
  transition: Transition,
): Op[] {
  const adjacent = Object.values(project.clips).find(
    (c) =>
      c.id !== clip.id &&
      c.trackId === clip.trackId &&
      Math.abs(
        side === 'transitionIn'
          ? c.start + c.duration - clip.start
          : clip.start + clip.duration - c.start,
      ) <
        0.5 / project.fps,
  );
  if (
    adjacent &&
    (adjacent.locked ||
      project.tracks.find((t) => t.id === adjacent.trackId)?.locked)
  )
    throw new Error('The adjacent clip is locked.');
  const ops: Op[] = [
    { op: 'clip.update', id: clip.id, patch: { [side]: transition } },
  ];
  if (adjacent)
    ops.push({
      op: 'clip.update',
      id: adjacent.id,
      patch: {
        [side === 'transitionIn' ? 'transitionOut' : 'transitionIn']:
          transition,
      },
    });
  return ops;
}
export function reorderEffects(
  effects: Clip['effects'],
  from: number,
  to: number,
): Clip['effects'] {
  const result = [...effects];
  if (from < 0 || from >= result.length || to < 0 || to >= result.length)
    return result;
  const item = result.splice(from, 1)[0];
  if (item) result.splice(to, 0, item);
  return result;
}
export type Param = {
  key: string;
  min: number;
  max: number;
  baseline: number;
  step?: number;
};
/** Shared core bounds; no Pixi-heavy filter import or duplicated range table. */
function parameter(
  kind: string,
  key: string,
  baseline: number,
  step = 1,
): Param {
  const range = effectParameterBounds[kind]?.[key];
  if (!range)
    throw new Error(`Missing core parameter contract: ${kind}.${key}`);
  return { key, min: range[0], max: range[1], baseline, step };
}
export const gradeParams: readonly Param[] = [
  parameter('grade', 'exposure', 0, 0.1),
  parameter('grade', 'contrast', 1, 0.01),
  parameter('grade', 'saturation', 1, 0.01),
  parameter('grade', 'temperature', 0, 0.01),
  parameter('grade', 'tint', 0, 0.01),
];
export function gradeChannelRange(
  kind: 'lift' | 'gamma' | 'gain',
): readonly [number, number] {
  const range = effectParameterBounds.grade?.[kind];
  if (!range) throw new Error(`Missing core channel contract: ${kind}`);
  return range;
}
export const effectParams: Readonly<Record<string, readonly Param[]>> = {
  blur: [parameter('blur', 'radius', 8), parameter('blur', 'x', 8)],
  vignette: [
    parameter('vignette', 'strength', 0.5, 0.01),
    { ...parameter('vignette', 'inner', 0.4, 0.01), max: 1.999999 },
    { ...parameter('vignette', 'outer', 1, 0.01), min: 0.000001 },
  ],
  grain: [
    parameter('grain', 'amount', 0.1, 0.01),
    parameter('grain', 'seed', 0),
  ],
  sharpen: [
    parameter('sharpen', 'amount', 1, 0.1),
    parameter('sharpen', 'radius', 1),
  ],
  black_white: [],
  bw: [],
  // The scene builder consumes these; UI upper bounds are proposed, not server constraints.
  zoom_punch_in: [
    { key: 'amount', min: 0, max: 16, baseline: 0, step: 0.01 },
    { key: 'attack', min: 0, max: 3600, baseline: 0.3, step: 0.01 },
    { key: 'release', min: 0, max: 3600, baseline: 0.3, step: 0.01 },
  ],
};
export function safePage(url: string | undefined) {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:'
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function numericParam(
  effect: Clip['effects'][number] | undefined,
  key: string,
  baseline: number,
) {
  const n = effect?.params[key];
  return typeof n === 'number' && Number.isFinite(n) ? n : baseline;
}
export const textStyleDefaults = [
  { id: 'caption-clean', size: 56, family: 'var(--font-sans)' },
  { id: 'caption-pop', size: 72, family: 'Anton, var(--font-sans)' },
  { id: 'caption-box', size: 48, family: 'var(--font-sans)' },
  { id: 'title-serif', size: 120, family: 'var(--font-display)' },
  { id: 'title-bold', size: 140, family: 'Anton, var(--font-sans)' },
  { id: 'lower-third', size: 40, family: 'var(--font-sans)' },
  { id: 'label-mono', size: 32, family: 'var(--font-mono)' },
  { id: 'quote', size: 64, family: 'DM Serif Display, var(--font-display)' },
] as const;
export function canonicalStyle(style: NonNullable<Clip['text']>['style']) {
  return style === 'title'
    ? 'title-serif'
    : style === 'caption'
      ? 'caption-clean'
      : style === 'lower_third'
        ? 'lower-third'
        : style;
}
/** HSV wheel, saturation radial, value fixed 1. No CSS decorative gradient. */
export function wheelRGB(x: number, y: number): [number, number, number] {
  const saturation = Math.min(1, Math.hypot(x, y));
  const hue = (Math.atan2(y, x) / (2 * Math.PI) + 1) % 1;
  const sector = hue * 6,
    chroma = saturation,
    secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const channels: [number, number, number][] = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ];
  return (channels[Math.floor(sector)] ?? [0, 0, 0]).map(
    (v) => v + 1 - chroma,
  ) as [number, number, number];
}
/** Wheel offsets around neutral, preserving a neutral center for lift/gamma/gain. */
export function wheelGrade(
  x: number,
  y: number,
  baseline: number,
  min: number,
  max: number,
): [number, number, number] {
  const rgb = wheelRGB(x, y),
    mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
  return rgb.map((v) => clamp(baseline + v - mean, min, max)) as [
    number,
    number,
    number,
  ];
}

export function canonicalEffect(kind: string): string {
  return (
    (
      {
        gaussian_blur: 'blur',
        film_grain: 'grain',
        black_and_white: 'black_white',
        zoom_punch: 'zoom_punch_in',
        colour_grade: 'grade',
      } as Record<string, string>
    )[kind] ?? kind
  );
}

/** Inverse chromatic coordinate for the RGB wheel marker, independent of neutral brightness. */
export function wheelPoint(
  rgb: readonly [number, number, number],
): readonly [number, number] {
  const max = Math.max(...rgb),
    min = Math.min(...rgb),
    span = max - min;
  if (span < 1e-9) return [0, 0];
  const hue =
    max === rgb[0]
      ? ((rgb[1] - rgb[2]) / span + 6) % 6
      : max === rgb[1]
        ? (rgb[2] - rgb[0]) / span + 2
        : (rgb[0] - rgb[1]) / span + 4;
  const angle = (hue / 6) * 2 * Math.PI,
    radius = Math.min(1, span);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}
