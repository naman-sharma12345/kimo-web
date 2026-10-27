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
  alignment?: 'left' | 'center' | 'right';
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
  if (text.fontSize !== undefined) style.fontSize = text.fontSize;
  if (text.alignment) style.alignment = text.alignment;
  if (text.color) {
    const [r, g, b, alpha] = text.color;
    style.fill = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
  }
  if (text.position === 'middle') style.placement = 'center';
  else if (text.position === 'bottom' || text.position === 'top')
    style.placement = 'bottom';
  if (text.animation === 'pop words') style.activeWordColor ??= '#FFD84D';
  const safeRect = {
    x: width * 0.05,
    y: height * 0.05,
    width: width * 0.9,
    height: height * 0.9,
  };
  const upper = (value: string) =>
    style.uppercase ? value.toUpperCase() : value;
  const content = upper(
    text.animation === 'type on'
      ? text.content.slice(0, Math.ceil(Math.max(0, animationTime) * 30))
      : text.content,
  );
  // Type-on uses its partial content, never the stale full timed-word renderer.
  const words =
    text.animation === 'type on'
      ? []
      : text.animation === 'pop words' && !text.words?.length
        ? // Derived preview animation only, not persisted subtitle/source timing.
          Array.from(text.content.matchAll(/\S+/g), (match) => ({
            w: match[0],
            t: match.index / 30,
            d: (match[0].length + 1) / 30,
          }))
        : (text.words ?? []);
  return {
    content,
    secondaryContent: text.secondaryContent ?? '',
    styleId,
    style,
    safeRect,
    scale: Math.min(width / 1920, height / 1080),
    ...(text.position === 'top' ? { verticalAnchor: 'top' as const } : {}),
    anchor: {
      x: style.placement === 'lower-left' ? safeRect.x : width / 2,
      y:
        style.placement === 'center'
          ? height / 2
          : text.position === 'top'
            ? safeRect.y
            : safeRect.y + safeRect.height,
    },
    words: words.map((word) => ({
      text: upper(word.w),
      start: word.t,
      end: word.t + word.d,
      active: word.t <= animationTime && animationTime < word.t + word.d,
    })),
  };
}

/** Shared by measured overlay and retained renderer; no font-size approximations. */
export function textAlignment(text: ResolvedText): 'left' | 'center' | 'right' {
  return (
    text.style.alignment ??
    (text.style.placement === 'lower-left' ? 'left' : 'center')
  );
}
export function textRowOffset(
  width: number,
  maxWidth: number,
  alignment: 'left' | 'center' | 'right',
): number {
  return alignment === 'left'
    ? 0
    : alignment === 'right'
      ? maxWidth - width
      : (maxWidth - width) / 2;
}
export function textBlockOrigin(
  text: ResolvedText,
  scene: { width: number; height: number },
  bounds: { width: number; height: number },
): { x: number; y: number } {
  return {
    x:
      text.anchor.x -
      scene.width / 2 -
      (text.style.placement === 'lower-left' ? 0 : bounds.width / 2),
    y:
      text.anchor.y -
      scene.height / 2 -
      (text.verticalAnchor === 'top'
        ? 0
        : text.style.placement === 'center'
          ? bounds.height / 2
          : bounds.height),
  };
}

/** Single CPU glyph-layout implementation shared by renderer and editor measurement.
 * Pixi is injected from the existing lazy import; this never constructs a renderer/context.
 */
export function createResolvedTextLayout(
  p: typeof import('pixi.js'),
  text: ResolvedText,
): {
  block: import('pixi.js').Container;
  words: import('pixi.js').Text[];
  primary: import('pixi.js').Text[];
  secondary?: import('pixi.js').Text;
  primaryStyle: import('pixi.js').TextStyle;
  secondaryStyle?: import('pixi.js').TextStyle;
} {
  const s = text.style,
    scale = text.scale;
  const options: Partial<import('pixi.js').TextStyleOptions> = {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize * scale,
    fontWeight: String(s.fontWeight) as '400' | '500',
    fontStyle: s.fontStyle,
    fill: s.fill,
    wordWrap: true,
    wordWrapWidth: text.safeRect.width,
    breakWords: true,
    align: textAlignment(text),
    ...(s.stroke
      ? {
          stroke: {
            color: s.stroke.color,
            alpha: s.stroke.alpha,
            width: s.stroke.width * scale,
          },
        }
      : {}),
  };
  const primaryStyle = new p.TextStyle(options);
  const block = new p.Container(),
    words: import('pixi.js').Text[] = [];
  const primary: import('pixi.js').Text[] = [];
  let secondary: import('pixi.js').Text | undefined;
  let secondaryStyle: import('pixi.js').TextStyle | undefined;
  try {
    if (s.activeWordColor && text.words.length) {
      const rows: import('pixi.js').Text[][] = [[]];
      let rowWidth = 0;
      const space = p.CanvasTextMetrics.measureText(' ', primaryStyle).width;
      for (const word of text.words) {
        const node = new p.Text({
          text: word.text,
          style: {
            ...options,
            wordWrap: false,
            fill: word.active ? s.activeWordColor : s.fill,
          },
        });
        if (
          rowWidth + node.width > text.safeRect.width &&
          (rows.at(-1)?.length ?? 0)
        ) {
          rows.push([]);
          rowWidth = 0;
        }
        const row = rows.at(-1);
        if (!row) throw new Error('Text row missing');
        row.push(node);
        words.push(node);
        primary.push(node);
        rowWidth += node.width + space;
      }
      const widths = rows.map(
        (row) =>
          row.reduce((n, node) => n + node.width, 0) +
          Math.max(0, row.length - 1) * space,
      );
      const maxWidth = Math.max(0, ...widths);
      let y = 0;
      rows.forEach((row, index) => {
        let x = textRowOffset(
            widths[index] ?? 0,
            maxWidth,
            textAlignment(text),
          ),
          height = 0;
        for (const node of row) {
          node.position.set(x, y);
          x += node.width + space;
          height = Math.max(height, node.height);
          block.addChild(node);
        }
        y += height;
      });
    } else {
      const node = new p.Text({ text: text.content, style: primaryStyle });
      primary.push(node);
      block.addChild(node);
    }
    if (s.secondary && text.secondaryContent) {
      secondaryStyle = new p.TextStyle({
        ...options,
        fontFamily: s.secondary.fontFamily,
        fontSize: s.secondary.fontSize * scale,
        fontWeight: '400',
      });
      secondary = new p.Text({
        text: text.secondaryContent,
        style: secondaryStyle,
      });
      secondary.y = block.getLocalBounds().height;
      block.addChild(secondary);
    }
    return { block, words, primary, secondary, primaryStyle, secondaryStyle };
  } catch (error) {
    // Include word nodes not yet attached when a measurement fails mid-row.
    for (const node of words) if (!node.parent) node.destroy();
    block.destroy({ children: true, texture: false, textureSource: false });
    throw error;
  }
}
