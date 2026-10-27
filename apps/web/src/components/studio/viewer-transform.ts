'use client';
import * as React from 'react';
import type { Clip } from '@kimo/client';
import type { EditingAPI } from '@/lib/editing/types';
type Transform = Clip['transform'];
export type TransformKind = 'move' | 'scale' | 'rotate';
export interface PointerPoint {
  x: number;
  y: number;
}
export function viewerTransform(
  base: Transform,
  kind: TransformKind,
  start: PointerPoint,
  end: PointerPoint,
  center: PointerPoint,
  displayScale: number,
): Transform {
  if (!Number.isFinite(displayScale) || displayScale <= 0)
    throw new Error('preview geometry is not ready');
  if (kind === 'move')
    return {
      ...base,
      x: base.x + (end.x - start.x) / displayScale,
      y: base.y + (end.y - start.y) / displayScale,
    };
  const a = { x: start.x - center.x, y: start.y - center.y },
    b = { x: end.x - center.x, y: end.y - center.y };
  if (kind === 'scale')
    return {
      ...base,
      scale: Math.max(
        0.01,
        (base.scale * Math.hypot(b.x, b.y)) / Math.max(1, Math.hypot(a.x, a.y)),
      ),
    };
  const delta = Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x);
  return { ...base, rotation: base.rotation + (delta * 180) / Math.PI };
}
export function useViewerTransform(
  editing: EditingAPI | null | undefined,
  displayScale: number,
  onError?: (message: string) => void,
) {
  const cleanup = React.useRef<(() => void) | null>(null);
  React.useEffect(
    () => () => {
      cleanup.current?.();
    },
    [editing],
  );
  return (
    event: React.PointerEvent<SVGElement>,
    clipId: string,
    kind: TransformKind,
  ) => {
    if (!editing || event.button !== 0 || cleanup.current) return;
    const project = editing.getState().project,
      clip = project.clips[clipId];
    if (
      !clip ||
      clip.locked ||
      project.tracks.find((track) => track.id === clip.trackId)?.locked
    )
      return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg || !Number.isFinite(displayScale) || displayScale <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = svg.getBoundingClientRect();
    const center = {
      x: rect.left + (project.width / 2 + clip.transform.x) * displayScale,
      y: rect.top + (project.height / 2 + clip.transform.y) * displayScale,
    };
    const start = { x: event.clientX, y: event.clientY },
      pointer = event.pointerId;
    const id = editing.beginEdit({
      clipIds: [clipId],
      label: `${kind} text`,
      source: 'viewer',
    });
    let frame: number | undefined,
      next: Transform | undefined,
      closed = false;
    const report = (error: unknown) =>
      onError?.(
        error instanceof Error ? error.message : 'viewer edit unavailable',
      );
    const preview = () => {
      frame = undefined;
      if (next && !closed)
        try {
          editing.previewEdit(id, [
            { op: 'clip.update', id: clipId, patch: { transform: next } },
          ]);
        } catch (error) {
          report(error);
          finish(true);
        }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer || closed) return;
      if (!next && e.clientX === start.x && e.clientY === start.y) return;
      next = viewerTransform(
        clip.transform,
        kind,
        start,
        { x: e.clientX, y: e.clientY },
        center,
        displayScale,
      );
      if (frame === undefined) frame = requestAnimationFrame(preview);
    };
    const detach = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      if (frame !== undefined) cancelAnimationFrame(frame);
      cleanup.current = null;
    };
    const finish = (abort: boolean) => {
      if (closed) return;
      closed = true;
      detach();
      if (abort || !next) editing.cancelEdit(id);
      else
        void editing
          .commitEdit(id, [
            { op: 'clip.update', id: clipId, patch: { transform: next } },
          ])
          .then((result) => {
            if (result.status === 'failed')
              onError?.(result.error ?? 'viewer edit could not be saved');
          })
          .catch(report);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      move(e);
      finish(false);
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === pointer) finish(true);
    };
    cleanup.current = () => finish(true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };
}
