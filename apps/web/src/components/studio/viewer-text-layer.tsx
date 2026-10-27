'use client';
import * as React from 'react';
import type { KimoProject } from '@kimo/client';
import {
  measureTextOverlay,
  type SceneGraph,
  type MeasuredTextOverlayBounds,
} from '@kimo/compositor';
import type { EditingAPI } from '@/lib/editing/types';
import { ViewerTextEditor } from './text-editing';
import styles from './compositor.module.css';
export function ViewerTextLayer({
  clipId,
  project,
  scene,
  editing,
  displayScale,
  onTransientHide,
  onFinish,
}: {
  clipId: string | null;
  project: KimoProject;
  scene: SceneGraph | null;
  editing: EditingAPI;
  displayScale: number;
  onTransientHide(clipId: string, hidden: boolean): void;
  onFinish(): void;
}) {
  const [measurement, setMeasurement] = React.useState<{
    key: string;
    value: MeasuredTextOverlayBounds;
  } | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);
  const restoreFocus = React.useRef<HTMLElement | null>(
    typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const clip = clipId ? project.clips[clipId] : undefined;
  const layer = scene?.layers.find((layer) => layer.clipId === clipId);
  const key = JSON.stringify([
    clipId,
    scene?.frame,
    scene?.width,
    scene?.height,
    layer?.text,
  ]);
  React.useEffect(() => {
    let disposed = false;
    setUnavailable(false);
    if (!scene || !layer?.text || !clipId) {
      setMeasurement(null);
      return;
    }
    const read = async () => {
      try {
        const value = await measureTextOverlay(layer, scene);
        if (disposed) return;
        if (value) setMeasurement({ key, value });
        else setUnavailable(true);
      } catch {
        if (!disposed) setUnavailable(true);
      }
    };
    void read();
    const loaded = () => {
      void read();
    };
    document.fonts?.addEventListener?.('loadingdone', loaded);
    if (document.fonts?.ready)
      void document.fonts.ready.then(() => {
        if (!disposed) void read();
      });
    return () => {
      disposed = true;
      document.fonts?.removeEventListener?.('loadingdone', loaded);
    };
  }, [scene, layer, clipId, key]);
  if (!clip?.text || !layer || !scene) return null;
  const measured = measurement?.key === key ? measurement.value : null;
  if (!measured || unavailable)
    return (
      <p role="status" className={styles.textLayoutStatus}>
        {unavailable
          ? 'text layout unavailable · use the inspector to edit'
          : 'text layout waiting for font'}
      </p>
    );
  return (
    <ViewerTextEditor
      editing={editing}
      clip={clip}
      active
      layout={{
        status: measured.status,
        sceneWidth: scene.width,
        sceneHeight: scene.height,
        displayScale,
        letterbox: { x: 0, y: 0 },
        transform: layer.transform,
        primary: measured.primary,
        secondary: measured.secondary,
      }}
      restoreFocusRef={restoreFocus}
      onTransientHide={onTransientHide}
      onFinish={onFinish}
    />
  );
}
