import type { Asset, KimoProject } from '@kimo/client';
import type { VideoRequest } from './media-types';
import type { RendererBranch, RendererResourceRequest } from './renderer-types';
import type { SceneGraph } from './types';

export interface ComparisonInput {
  id: string;
  project: KimoProject;
  assets: readonly Asset[];
  split: number;
}
export type ComparisonPhase =
  'inactive' | 'preparing' | 'ready' | 'unavailable';
export interface ComparisonState {
  readonly phase: ComparisonPhase;
  readonly id: string | null;
  readonly split: number;
  readonly reason: string | null;
  readonly requiredDecoders: number;
  readonly approximations: readonly string[];
}
export type CutComparisonCapability =
  { available: true } | { available: false; reason: string };
export function comparisonSplit(value: number): number {
  if (!Number.isFinite(value))
    throw new RangeError('Comparison split must be finite');
  return Math.max(0, Math.min(1, value));
}
/** Opaque preview instance only. Never written into project/asset identities. */
export function comparisonInstance(
  generation: number,
  branch: RendererBranch,
  clipId: string,
  role: 'media' | 'mask',
): string {
  return JSON.stringify(['comparison', generation, branch, clipId, role]);
}
export function comparisonAsset(generation: number, assetId: string): string {
  return JSON.stringify(['comparison', generation, 'historical', assetId]);
}
/** Exact visible demand, including resolved transition handles and mask origins. No preroll. */
export function comparisonResources(
  project: KimoProject,
  assets: Readonly<Record<string, Asset>>,
  scene: SceneGraph,
  branch: RendererBranch,
  generation: number,
): {
  videos: VideoRequest[];
  resources: RendererResourceRequest[];
  currentMedia: Map<string, string>;
} {
  const videos: VideoRequest[] = [];
  const resources: RendererResourceRequest[] = [];
  const currentMedia = new Map<string, string>();
  for (const layer of scene.layers) {
    const clip = project.clips[layer.clipId];
    if (!clip) continue;
    const add = (
      assetId: string,
      role: 'media' | 'mask' | 'lut',
      sourceTime: number,
      frameIndex?: number,
    ) => {
      resources.push({
        branch,
        clipId: layer.clipId,
        assetId,
        role,
        sourceTime,
        frameIndex,
      });
      const asset = assets[assetId];
      if (asset?.kind !== 'video' || role === 'lut') return;
      const instance = comparisonInstance(generation, branch, clip.id, role);
      if (branch === 'current' && role === 'media')
        currentMedia.set(instance, clip.id);
      videos.push({
        clipId: instance,
        asset,
        start: scene.time,
        duration: 1 / project.fps,
        in: sourceTime,
        speed: clip.speed,
        purpose: role === 'mask' ? 'mask' : 'video',
        sourceTiming: {
          timelineTime: scene.time,
          mediaTime: Math.max(
            0,
            sourceTime -
              (role === 'mask' ? (layer.mask?.metadata?.timeOrigin ?? 0) : 0),
          ),
          rate: layer.transitionSample?.mode === 'boundary' ? 0 : clip.speed,
        },
      });
    };
    if (layer.assetId && (layer.kind === 'video' || layer.kind === 'image'))
      add(layer.assetId, 'media', layer.sourceTime);
    if (layer.mask)
      add(
        layer.mask.assetId,
        'mask',
        layer.mask.sourceTime,
        layer.mask.frameIndex,
      );
    for (const effect of layer.effects) {
      const id = effect.params.assetId ?? effect.params.lutAssetId;
      if (
        typeof id === 'string' &&
        (effect.kind === 'lut' || typeof effect.params.lutAssetId === 'string')
      )
        add(id, 'lut', layer.sourceTime);
    }
  }
  return { videos, resources, currentMedia };
}
