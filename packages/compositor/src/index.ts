import type { Application } from 'pixi.js';
/** Phase 6 integration boundary. No editor/compositing is claimed yet. */
export interface CompositorFoundation {
  application: Application | null;
  videos: Map<string, HTMLVideoElement>;
}
export const videoCache = new Map<string, HTMLVideoElement>();
export function prefetchVideos(
  assets: readonly { id: string; url: string; proxyUrl?: string }[],
): void {
  for (const asset of assets.slice(0, 3)) {
    if (videoCache.has(asset.id)) continue;
    const video = document.createElement('video');
    video.muted = true;
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
