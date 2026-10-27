import type { Clip } from '@kimo/client';
import type { ResolvedText } from './types';

export type TextStyleId =
  | 'caption-clean'
  | 'caption-pop'
  | 'caption-box'
  | 'title-serif'
  | 'title-bold'
  | 'lower-third'
  | 'label-mono'
  | 'quote';
export interface TextStyle {
  id: TextStyleId;
  fontFamily:
    'Geist' | 'Geist Mono' | 'Instrument Serif' | 'Anton' | 'DM Serif Display';
  fontWeight: 400 | 500;
  fontSize: number;
  fontStyle: 'normal' | 'italic';
  fill: string;
  uppercase: boolean;
  placement: 'bottom' | 'center' | 'lower-left';
  stroke?: { color: string; alpha: number; width: number };
  activeWordColor?: string;
  background?: {
    color: string;
    alpha: number;
    radius: number;
    padding: number;
  };
  secondary?: { fontFamily: 'Geist'; fontWeight: 400; fontSize: 28 };
}
/** In-video content colors, not UI tokens. Geometry defaults are proposed in FIDELITY.md. */
export const textStyles: Readonly<Record<TextStyleId, TextStyle>> = {
  'caption-clean': {
    id: 'caption-clean',
    fontFamily: 'Geist',
    fontWeight: 500,
    fontSize: 56,
    fontStyle: 'normal',
    fill: '#FFFFFF',
    uppercase: false,
    placement: 'bottom',
    stroke: { color: '#000000', alpha: 0.25, width: 2 },
  },
  'caption-pop': {
    id: 'caption-pop',
    fontFamily: 'Anton',
    fontWeight: 400,
    fontSize: 72,
    fontStyle: 'normal',
    fill: '#FFFFFF',
    uppercase: true,
    placement: 'bottom',
    activeWordColor: '#FFD84D',
  },
  'caption-box': {
    id: 'caption-box',
    fontFamily: 'Geist',
    fontWeight: 500,
    fontSize: 48,
    fontStyle: 'normal',
    fill: '#FFFFFF',
    uppercase: false,
    placement: 'bottom',
    background: { color: '#000000', alpha: 0.7, radius: 8, padding: 16 },
  },
  'title-serif': {
    id: 'title-serif',
    fontFamily: 'Instrument Serif',
    fontWeight: 400,
    fontSize: 120,
    fontStyle: 'italic',
    fill: '#FFFFFF',
    uppercase: false,
    placement: 'center',
  },
  'title-bold': {
    id: 'title-bold',
    fontFamily: 'Anton',
    fontWeight: 400,
    fontSize: 140,
    fontStyle: 'normal',
    fill: '#FFFFFF',
    uppercase: false,
    placement: 'center',
  },
  'lower-third': {
    id: 'lower-third',
    fontFamily: 'Geist',
    fontWeight: 500,
    fontSize: 40,
    fontStyle: 'normal',
    fill: '#FFFFFF',
    uppercase: false,
    placement: 'lower-left',
    background: { color: '#000000', alpha: 0.7, radius: 8, padding: 16 },
    secondary: { fontFamily: 'Geist', fontWeight: 400, fontSize: 28 },
  },
  'label-mono': {
    id: 'label-mono',
    fontFamily: 'Geist Mono',
    fontWeight: 400,
    fontSize: 32,
    fontStyle: 'normal',
    fill: '#FFFFFF',
    uppercase: false,
    placement: 'lower-left',
  },
  quote: {
    id: 'quote',
    fontFamily: 'DM Serif Display',
    fontWeight: 400,
    fontSize: 64,
    fontStyle: 'normal',
    fill: '#FFFFFF',
    uppercase: false,
    placement: 'center',
  },
};
// Protect the pure builder's constant inputs from external registry mutation.
for (const style of Object.values(textStyles)) {
  if (style.stroke) Object.freeze(style.stroke);
  if (style.background) Object.freeze(style.background);
  if (style.secondary) Object.freeze(style.secondary);
  Object.freeze(style);
}
Object.freeze(textStyles);
export const TEXT_STYLES = textStyles;
export function normalizeTextStyleId(
  id: NonNullable<Clip['text']>['style'],
): TextStyleId {
  if (id === 'title') return 'title-serif';
  if (id === 'caption') return 'caption-clean';
  if (id === 'lower_third') return 'lower-third';
  return id;
}
export function resolveText(
  text: NonNullable<Clip['text']>,
  animationTime: number,
  width: number,
  height: number,
): ResolvedText {
  const styleId = normalizeTextStyleId(text.style);
  const style = structuredClone(textStyles[styleId]);
  const safeRect = {
    x: width * 0.05,
    y: height * 0.05,
    width: width * 0.9,
    height: height * 0.9,
  };
  const upper = (value: string) =>
    style.uppercase ? value.toUpperCase() : value;
  return {
    content: upper(text.content),
    secondaryContent: text.secondaryContent ?? '',
    styleId,
    style,
    safeRect,
    scale: Math.min(width / 1920, height / 1080),
    anchor: {
      x: style.placement === 'lower-left' ? safeRect.x : width / 2,
      y:
        style.placement === 'center'
          ? height / 2
          : safeRect.y + safeRect.height,
    },
    words: (text.words ?? []).map((word) => ({
      text: upper(word.w),
      start: word.t,
      end: word.t + word.d,
      active: word.t <= animationTime && animationTime < word.t + word.d,
    })),
  };
}
