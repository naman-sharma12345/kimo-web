import { createResolvedTextLayout, textBlockOrigin } from './text-styles';
import type { Application } from 'pixi.js';
/** Legacy warm-up boundary retained for existing consumers; live preview is exported below. */
export interface CompositorFoundation {
  application: Application | null;
  videos: Map<string, HTMLVideoElement>;
}
let compositorMediaOwners = 0;
/** Warm-up cannot create uncounted elements once the Studio pool owns the budget. */
export function retainCompositorMediaOwnership(): () => void {
  compositorMediaOwners++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      compositorMediaOwners--;
    }
  };
}
export const videoCache = new Map<string, HTMLVideoElement>();
export function prefetchVideos(
  assets: readonly { id: string; url: string; proxyUrl?: string }[],
): void {
  if (typeof document === 'undefined' || compositorMediaOwners > 0) return;
  for (const asset of assets) {
    if (videoCache.size >= 6) break;
    if (videoCache.has(asset.id)) continue;
    const video = document.createElement('video');
    video.muted = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.src = asset.proxyUrl ?? asset.url;
    video.load();
    videoCache.set(asset.id, video);
  }
}
export function clearVideoCache(): void {
  for (const video of videoCache.values()) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  videoCache.clear();
}

export {
  CompositorController,
  affectedClipIds,
  previewSize,
} from './controller';
export type {
  ControllerOptions,
  ControllerPreviewAPI,
  ControllerMetrics,
  TransportState,
  ActionOverlay,
} from './controller';
export {
  buildScene,
  PureSceneBuilder,
  interpolateKeyframes,
} from './scene-builder';
export { MediaPool } from './media-pool';
export { AudioEngine, audioCapabilities } from './audio-engine';
export type { AudioLevels, AudioCapabilities } from './audio-engine';
export { TimelineClock } from './clock';
export { FilmstripService, FilmstripWorkerEncoder } from './filmstrip';
export { PixiRenderer } from './pixi-renderer';
export { textStyles } from './text-styles';
export type { SceneGraph, ResolvedLayer } from './types';

export type {
  FilmstripCache,
  FilmstripCacheEntry,
  TimestampedFrame,
} from './filmstrip';

export type { PreparedRendererResource, SceneRenderer } from './renderer-types';

import type { ResolvedLayer, SceneGraph } from './types';
export interface TextGlyphBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface MeasuredTextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  lineHeight: number;
  letterSpacing: number;
  color: string;
  textAlign: 'left' | 'center' | 'right';
  textTransform?: 'uppercase' | 'none';
  WebkitTextStroke?: string;
}
export interface MeasuredTextRegion {
  bounds: TextGlyphBounds;
  style: MeasuredTextStyle;
}
export type TextFontStatus = 'ready' | 'font-pending' | 'unavailable';
export interface TextOverlayBounds extends TextGlyphBounds {
  words: TextGlyphBounds[];
  /** Ready means requested registered faces loaded, never merely a system fallback. */
  status?: TextFontStatus;
  primary?: MeasuredTextRegion;
  secondary?: MeasuredTextRegion;
}
/** Actual measurement result guarantees primary/status; legacy combined-bound values need not. */
export interface MeasuredTextOverlayBounds extends TextOverlayBounds {
  status: TextFontStatus;
  primary: MeasuredTextRegion;
}
export interface TextMeasurementOptions {
  /** Explicit font-load boundary for tests/hosts; true must mean requested face loaded. */
  loadFont?: (css: string, content: string) => Promise<boolean>;
}
const measurementFontStates = new Map<string, TextFontStatus>();
async function measuredFontStatus(
  text: NonNullable<ResolvedLayer['text']>,
  options: TextMeasurementOptions,
): Promise<TextFontStatus> {
  const s = text.style;
  const requests = [
    {
      css: `${s.fontStyle} ${s.fontWeight} ${s.fontSize * text.scale}px "${s.fontFamily}"`,
      content: text.content || ' ',
    },
  ];
  if (s.secondary && text.secondaryContent)
    requests.push({
      css: `normal ${s.secondary.fontWeight} ${s.secondary.fontSize * text.scale}px "${s.secondary.fontFamily}"`,
      content: text.secondaryContent,
    });
  const statuses = await Promise.all(
    requests.map(async ({ css, content }): Promise<TextFontStatus> => {
      try {
        if (options.loadFont)
          return (await options.loadFont(css, content))
            ? 'ready'
            : 'unavailable';
        if (
          typeof document === 'undefined' ||
          !document.fonts ||
          typeof document.fonts.load !== 'function'
        )
          return 'unavailable';
        const fonts = document.fonts;
        // Start the requested face load, but return pending promptly for a read-only editor.
        const pending = fonts
          .load(css, content)
          .then(
            (faces) =>
              faces.length > 0 &&
              faces.every((face) => face.status === 'loaded') &&
              fonts.check(css, content),
          )
          .catch(() => false);
        if (fonts.status === 'loading') return 'font-pending';
        return (await pending) ? 'ready' : 'unavailable';
      } catch {
        return 'unavailable';
      }
    }),
  );
  return statuses.includes('unavailable')
    ? 'unavailable'
    : statuses.includes('font-pending')
      ? 'font-pending'
      : 'ready';
}
/** Same actual Pixi CPU glyph layout as renderer. No GPU renderer/context/ticker is created.
 * Bounds are before clip transforms, in content pixels relative to scene centre.
 * Non-ready measurements may reflect fallback geometry and MUST NOT hide the preview.
 */
export async function measureTextOverlay(
  layer: ResolvedLayer,
  scene: SceneGraph,
  options: TextMeasurementOptions = {},
): Promise<MeasuredTextOverlayBounds | undefined> {
  const text = layer.text;
  if (!text) return undefined;
  const status = await measuredFontStatus(text, options);
  const p = await import('pixi.js');
  const fontKey = JSON.stringify([
    text.style.fontFamily,
    text.style.fontSize * text.scale,
    text.style.fontWeight,
    text.style.fontStyle,
    text.style.secondary,
  ]);
  // Pixi caches fallback font metrics too. Do not reuse those after a verified face loads.
  if (status === 'ready' && measurementFontStates.get(fontKey) !== 'ready')
    p.CanvasTextMetrics.clearMetrics();
  if (
    measurementFontStates.size >= 128 &&
    !measurementFontStates.has(fontKey)
  ) {
    const oldest = measurementFontStates.keys().next().value;
    if (oldest !== undefined) measurementFontStates.delete(oldest);
  }
  measurementFontStates.set(fontKey, status);
  const layout = createResolvedTextLayout(p, text);
  const { block, words } = layout;
  try {
    const bounds = block.getLocalBounds();
    const { x, y } = textBlockOrigin(text, scene, bounds);
    const offsetX = x - bounds.x,
      offsetY = y - bounds.y;
    const glyph = (node: import('pixi.js').Text): TextGlyphBounds => {
      const box = node.getLocalBounds();
      return {
        x: offsetX + node.x + box.x,
        y: offsetY + node.y + box.y,
        width: box.width,
        height: box.height,
      };
    };
    const union = (nodes: import('pixi.js').Text[]): TextGlyphBounds => {
      const boxes = nodes.map(glyph);
      if (!boxes.length) return { x, y, width: 0, height: 0 };
      const left = Math.min(...boxes.map((b) => b.x)),
        top = Math.min(...boxes.map((b) => b.y));
      return {
        x: left,
        y: top,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - left,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - top,
      };
    };
    const typography = (
      style: import('pixi.js').TextStyle,
      content: string,
    ): MeasuredTextStyle => {
      const metrics = p.CanvasTextMetrics.measureText(content || ' ', style);
      if (
        !Number.isFinite(metrics.lineHeight) ||
        metrics.lineHeight <= 0 ||
        !Number.isFinite(style.letterSpacing)
      )
        throw new Error('Pixi text typography metrics unavailable');
      const stroke = text.style.stroke;
      const hex = stroke?.color.match(/^#([0-9a-f]{6})$/i)?.[1];
      const strokeColor =
        hex && stroke
          ? `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, ${stroke.alpha})`
          : stroke?.color;
      return {
        fontFamily: String(style.fontFamily),
        fontSize: style.fontSize,
        fontWeight: Number(style.fontWeight),
        fontStyle: style.fontStyle,
        lineHeight: metrics.lineHeight,
        letterSpacing: style.letterSpacing,
        color: text.style.fill,
        textTransform: text.style.uppercase ? 'uppercase' : 'none',
        textAlign:
          text.style.alignment ??
          (text.style.placement === 'lower-left' ? 'left' : 'center'),
        ...(text.style.stroke
          ? {
              WebkitTextStroke: `${text.style.stroke.width * text.scale}px ${strokeColor}`,
            }
          : {}),
      };
    };
    return {
      x,
      y,
      width: bounds.width,
      height: bounds.height,
      words: words.map(glyph),
      status,
      primary: {
        bounds: union(layout.primary),
        style: typography(layout.primaryStyle, text.content),
      },
      ...(layout.secondary && layout.secondaryStyle
        ? {
            secondary: {
              bounds: glyph(layout.secondary),
              style: typography(layout.secondaryStyle, text.secondaryContent),
            },
          }
        : {}),
    };
  } finally {
    block.destroy({ children: true, texture: false, textureSource: false });
  }
}
/** Alias for the rich layout seam; existing combined measureTextOverlay fields remain. */
export const measureResolvedTextLayout = measureTextOverlay;
