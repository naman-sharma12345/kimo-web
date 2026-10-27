'use client';
import * as React from 'react';
import type { Asset, KimoProject } from '@kimo/client';
import type { ActionOverlay, SceneGraph } from '@kimo/compositor';
import { useStudio } from '@/stores/studio';
import styles from './compositor.module.css';
import { measureTextOverlay, type TextOverlayBounds } from '@kimo/compositor';
export interface OverlayEditIntent {
  clipId: string;
  kind: 'move' | 'scale' | 'rotate' | 'text';
}
export function sourcePolygonTransform(
  project: KimoProject,
  asset: Asset | undefined,
  clipId: string,
  scene: SceneGraph | null,
): string {
  const clip =
    scene?.layers.find((layer) => layer.clipId === clipId) ??
    project.clips[clipId];
  const transform = clip?.transform;
  const width = asset?.width ?? project.width;
  const height = asset?.height ?? project.height;
  const fit = Math.min(project.width / width, project.height / height);
  return `translate(${project.width / 2 + (transform?.x ?? 0)} ${project.height / 2 + (transform?.y ?? 0)}) rotate(${transform?.rotation ?? 0}) scale(${(transform?.scale ?? 1) * fit}) translate(${-width / 2} ${-height / 2}) scale(${width} ${height})`;
}
/** Screen-aligned region corners are 12 CSS pixels regardless of viewer zoom. */
export function bracketPath(
  x: number,
  y: number,
  w: number,
  h: number,
  length: number,
): string {
  const a = Math.min(length, w / 2),
    b = Math.min(length, h / 2);
  const r = Math.min(length / 3, a / 2, b / 2);
  return `M${x} ${y + b}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + a} M${x + w - a} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + b} M${x + w} ${y + h - b}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + w - a} M${x + a} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + h - b}`;
}
export function CompositorOverlay({
  project,
  assets = [],
  scene,
  overlay,
  maskEdge,
  onEditIntent,
  displayScale,
}: {
  project: KimoProject;
  assets?: Asset[];
  scene: SceneGraph | null;
  overlay: ActionOverlay | null;
  maskEdge?: string;
  onEditIntent?: (intent: OverlayEditIntent) => void;
  displayScale?: number;
}) {
  const guides = useStudio((s) => s.guides);
  const overlays = useStudio((s) => s.overlays);
  const selected = useStudio((s) => s.selection);
  const maskOpen = useStudio((s) => s.maskSectionOpen);
  const [measured, setMeasured] = React.useState<
    Record<string, TextOverlayBounds>
  >({});
  React.useEffect(() => {
    let disposed = false;
    if (!scene) {
      setMeasured({});
      return;
    }
    void Promise.all(
      scene.layers
        .filter((layer) => selected.includes(layer.clipId) && layer.text)
        .map(async (layer) => ({
          id: layer.clipId,
          bounds: await measureTextOverlay(layer, scene),
        })),
    )
      .then((values) => {
        if (!disposed)
          setMeasured(
            Object.fromEntries(
              values.flatMap((value) =>
                value.bounds ? [[value.id, value.bounds]] : [],
              ),
            ),
          );
      })
      .catch(() => {
        if (!disposed) setMeasured({});
      });
    return () => {
      disposed = true;
    };
  }, [scene, selected]);
  const [visible, setVisible] = React.useState<ActionOverlay | null>(overlay);
  const svg = React.useRef<SVGSVGElement>(null);
  React.useEffect(() => {
    setVisible(overlay);
    if (!overlay?.ended || maskOpen) return;
    const timer = setTimeout(() => setVisible(null), 600);
    return () => clearTimeout(timer);
  }, [overlay, maskOpen]);
  const region = visible?.target?.region;
  const mask = visible?.mask;
  const polygon: readonly (readonly [number, number])[] | undefined =
    mask?.previewPolygon ?? visible?.target?.previewPolygon;
  const clipId = mask?.clipId ?? visible?.target?.clipId;
  const sourceAsset = assets.find(
    (asset) => asset.id === project.clips[clipId ?? '']?.assetId,
  );
  const basis = mask?.coordinateSpace ?? visible?.target?.coordinateSpace;
  const label = mask?.subjectLabel ?? visible?.target?.subjectLabel;
  const sourceClip =
    scene?.layers.find((layer) => layer.clipId === clipId) ??
    project.clips[clipId ?? ''];
  const sourceTransform = sourceClip?.transform;
  const radians = ((sourceTransform?.rotation ?? 0) * Math.PI) / 180;
  const sourceWidth = sourceAsset?.width ?? project.width,
    sourceHeight = sourceAsset?.height ?? project.height;
  const sourceFit =
    Math.min(project.width / sourceWidth, project.height / sourceHeight) *
    (sourceTransform?.scale ?? 1);
  const projected = (polygon ?? []).map(([u, v]) => {
    const x = (u - 0.5) * sourceWidth * sourceFit,
      y = (v - 0.5) * sourceHeight * sourceFit;
    return {
      x:
        project.width / 2 +
        (sourceTransform?.x ?? 0) +
        x * Math.cos(radians) -
        y * Math.sin(radians),
      y:
        project.height / 2 +
        (sourceTransform?.y ?? 0) +
        x * Math.sin(radians) +
        y * Math.cos(radians),
    };
  });
  const labelX = projected.length
    ? Math.max(0, Math.min(...projected.map((point) => point.x)))
    : (region?.x ?? project.width * 0.05);
  const labelY = projected.length
    ? Math.max(0, Math.min(...projected.map((point) => point.y)))
    : (region?.y ?? project.height * 0.05);
  const screenScale =
    displayScale ??
    (svg.current?.getBoundingClientRect().width ?? project.width) /
      project.width;
  const length = 12 / Math.max(screenScale, 0.001);
  const intent = (value: OverlayEditIntent) => {
    onEditIntent?.(value);
    svg.current?.dispatchEvent(
      new CustomEvent<OverlayEditIntent>('kimo:overlay-edit-intent', {
        detail: value,
        bubbles: true,
      }),
    );
  };
  return (
    <svg
      ref={svg}
      className={styles.overlay}
      viewBox={`0 0 ${project.width} ${project.height}`}
      aria-label="preview overlays"
      data-guides={guides}
      data-ai-overlays={overlays}
      data-text-bounds-ready={selected.every(
        (id) => project.clips[id]?.kind !== 'text' || !!measured[id],
      )}
    >
      {guides ? (
        <g className={styles.guides} data-testid="compositor-guides">
          {[1, 2].map((n) => (
            <React.Fragment key={n}>
              <line
                x1={(project.width * n) / 3}
                y1={0}
                x2={(project.width * n) / 3}
                y2={project.height}
              />
              <line
                x1={0}
                y1={(project.height * n) / 3}
                x2={project.width}
                y2={(project.height * n) / 3}
              />
            </React.Fragment>
          ))}
          <rect
            x={project.width * 0.05}
            y={project.height * 0.05}
            width={project.width * 0.9}
            height={project.height * 0.9}
          />
        </g>
      ) : null}
      {overlays && visible ? (
        <g
          key={visible.actionId}
          className={styles.ai}
          data-ended={visible.ended && !maskOpen}
        >
          {polygon?.length && clipId && basis === 'source_uv' ? (
            <>
              <polygon
                className={styles.polygon}
                data-edge-ready={!!maskEdge}
                transform={sourcePolygonTransform(
                  project,
                  sourceAsset,
                  clipId,
                  scene,
                )}
                points={polygon.map((point) => point.join(',')).join(' ')}
              />
              {maskEdge ? (
                <path
                  className={styles.maskEdge}
                  data-testid="actual-mask-edge"
                  transform={sourcePolygonTransform(
                    project,
                    sourceAsset,
                    clipId,
                    scene,
                  )}
                  d={maskEdge}
                />
              ) : null}
              <foreignObject
                x={labelX}
                y={labelY}
                width={project.width * 0.5}
                height={project.height * 0.1}
              >
                <span
                  className={styles.maskLabel}
                  style={{
                    transform: `scale(${1 / Math.max(screenScale, 0.001)})`,
                    transformOrigin: 'top left',
                  }}
                >
                  sam 3.1{label ? ` · ${label}` : ''}
                </span>
              </foreignObject>
            </>
          ) : region ? (
            <path
              className={styles.brackets}
              d={bracketPath(region.x, region.y, region.w, region.h, length)}
            />
          ) : null}
        </g>
      ) : null}
      {selected.map((id) => {
        const layer = scene?.layers.find((layer) => layer.clipId === id);
        if (!layer?.text) return null;
        const rect = measured[id];
        if (!rect) return null;
        const transform = layer.transform;
        const x = rect.x,
          y = rect.y;
        const handleScale = Math.max(
          screenScale * Math.abs(transform.scale),
          0.001,
        );
        const size = 6 / handleScale;
        return (
          <g
            key={id}
            className={styles.textBounds}
            transform={`translate(${project.width / 2 + transform.x} ${project.height / 2 + transform.y}) rotate(${transform.rotation}) scale(${transform.scale})`}
            data-measured-bounds="pixi-loaded-font"
            onDoubleClick={() => intent({ clipId: id, kind: 'text' })}
          >
            <rect
              x={x}
              y={y}
              width={rect.width}
              height={rect.height}
              role="button"
              tabIndex={0}
              aria-label="move text (Phase 7 intent)"
              onClick={() => intent({ clipId: id, kind: 'move' })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  intent({ clipId: id, kind: 'move' });
                }
              }}
            />
            {rect.words.map((word, index) => (
              <rect
                key={index}
                x={word.x}
                y={word.y}
                width={word.width}
                height={word.height}
                className={styles.wordBounds}
              />
            ))}
            {(
              [
                [x, y],
                [x + rect.width, y],
                [x, y + rect.height],
                [x + rect.width, y + rect.height],
                [x + rect.width / 2, y - 16 / handleScale],
              ] as const
            ).map(([hx, hy], index) => (
              <rect
                key={index}
                x={hx - size / 2}
                y={hy - size / 2}
                width={size}
                height={size}
                rx={1 / handleScale}
                role="button"
                tabIndex={0}
                aria-label={
                  index === 4
                    ? 'rotate text (Phase 7 intent)'
                    : 'scale text (Phase 7 intent)'
                }
                className={styles.handle}
                onClick={() =>
                  intent({ clipId: id, kind: index === 4 ? 'rotate' : 'scale' })
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    intent({
                      clipId: id,
                      kind: index === 4 ? 'rotate' : 'scale',
                    });
                  }
                }}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
