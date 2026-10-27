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
export { AudioEngine } from './audio-engine';
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
export interface TextOverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  words: { x: number; y: number; width: number; height: number }[];
}
/** Same loaded-font Pixi CPU layout as the renderer, using browser 2D metrics but no GPU renderer or ticker. */
export async function measureTextOverlay(
  layer: ResolvedLayer,
  scene: SceneGraph,
): Promise<TextOverlayBounds | undefined> {
  const text = layer.text;
  if (!text) return undefined;
  const p = await import('pixi.js');
  const s = text.style,
    scale = text.scale;
  const style: Partial<import('pixi.js').TextStyleOptions> = {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize * scale,
    fontWeight: String(s.fontWeight) as '400' | '500',
    fontStyle: s.fontStyle,
    fill: s.fill,
    wordWrap: true,
    wordWrapWidth: text.safeRect.width,
    breakWords: true,
    align: s.placement === 'lower-left' ? 'left' : 'center',
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
  const block = new p.Container();
  const words: import('pixi.js').Text[] = [];
  try {
    if (s.activeWordColor && text.words.length) {
      const rows: import('pixi.js').Text[][] = [[]];
      let rowWidth = 0;
      const space = p.CanvasTextMetrics.measureText(
        ' ',
        new p.TextStyle(style),
      ).width;
      for (const word of text.words) {
        const node = new p.Text({
          text: word.text,
          style: { ...style, wordWrap: false },
        });
        if (
          rowWidth + node.width > text.safeRect.width &&
          (rows[rows.length - 1]?.length ?? 0)
        ) {
          rows.push([]);
          rowWidth = 0;
        }
        const row = rows[rows.length - 1];
        if (!row) throw new Error('Text row missing');
        row.push(node);
        words.push(node);
        rowWidth += node.width + space;
      }
      let y = 0;
      for (const row of rows) {
        const width =
          row.reduce((n, node) => n + node.width, 0) +
          Math.max(0, row.length - 1) * space;
        let x = -width / 2,
          height = 0;
        for (const node of row) {
          node.position.set(x, y);
          x += node.width + space;
          height = Math.max(height, node.height);
          block.addChild(node);
        }
        y += height;
      }
    } else {
      const primary = new p.Text({ text: text.content, style });
      block.addChild(primary);
      if (s.secondary && text.secondaryContent) {
        const secondary = new p.Text({
          text: text.secondaryContent,
          style: {
            ...style,
            fontFamily: s.secondary.fontFamily,
            fontSize: s.secondary.fontSize * scale,
            fontWeight: '400',
          },
        });
        secondary.y = primary.height;
        block.addChild(secondary);
      }
    }
    const bounds = block.getLocalBounds();
    const x =
      text.anchor.x -
      scene.width / 2 -
      (s.placement === 'lower-left' ? 0 : bounds.width / 2);
    const y =
      text.anchor.y -
      scene.height / 2 -
      (s.placement === 'center' ? bounds.height / 2 : bounds.height);
    const offsetX = x - bounds.x,
      offsetY = y - bounds.y;
    return {
      x,
      y,
      width: bounds.width,
      height: bounds.height,
      words: words.map((word) => {
        const box = word.getLocalBounds();
        return {
          x: offsetX + word.x + box.x,
          y: offsetY + word.y + box.y,
          width: box.width,
          height: box.height,
        };
      }),
    };
  } finally {
    block.destroy({ children: true, texture: false, textureSource: false });
  }
}
