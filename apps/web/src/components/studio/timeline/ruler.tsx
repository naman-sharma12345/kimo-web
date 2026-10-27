'use client';
import * as React from 'react';
import { useEffect, useRef } from 'react';
import type { KimoProject } from '@kimo/client';
import { majorInterval, timecode } from './geometry';
import styles from './timeline.module.css';
export function TimelineRuler({
  project,
  playhead,
  markerOrigins,
  width,
  scroll,
  zoom,
  onStart,
  onScrub,
  onEnd,
}: {
  project: KimoProject;
  playhead: number;
  markerOrigins?: Readonly<Record<string, 'agent' | 'user'>>;
  width: number;
  scroll: number;
  zoom: number;
  onStart: () => void;
  onScrub: (time: number) => void;
  onEnd: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);
  const endCallback = useRef(onEnd);
  endCallback.current = onEnd;
  useEffect(
    () => () => {
      if (dragging.current !== null) endCallback.current();
    },
    [],
  );
  useEffect(() => {
    const node = canvas.current;
    const ctx = node?.getContext('2d');
    if (!node || !ctx) return;
    const css = window.getComputedStyle(node);
    const color = (name: string) => css.getPropertyValue(name).trim();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    node.width = Math.ceil(width * dpr);
    node.height = 28 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = color('--ink-1');
    ctx.fillRect(0, 0, width, 28);
    ctx.font = `${color('--weight-12')} ${color('--t-11')} ${color('--font-mono')}`;
    ctx.textBaseline = 'top';
    const interval = majorInterval(zoom);
    const first = Math.floor(scroll / zoom / interval) * interval;
    ctx.strokeStyle = color('--cream-16');
    ctx.lineWidth = 1;
    for (let time = first; time * zoom - scroll <= width; time += interval) {
      const x = time * zoom - scroll;
      ctx.fillStyle = color('--cream-38');
      ctx.fillText(timecode(time), x + 4, 2);
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, 28);
      ctx.stroke();
      for (let i = 1; i < 5; i++) {
        const minor = x + (i * interval * zoom) / 5;
        ctx.beginPath();
        ctx.moveTo(minor, 24);
        ctx.lineTo(minor, 28);
        ctx.stroke();
      }
    }
    if (zoom >= 300)
      for (
        let frame = Math.floor((scroll / zoom) * project.fps);
        (frame / project.fps) * zoom - scroll <= width;
        frame++
      ) {
        const x = (frame / project.fps) * zoom - scroll;
        ctx.beginPath();
        ctx.moveTo(x, 26);
        ctx.lineTo(x, 28);
        ctx.stroke();
      }
  }, [project.fps, width, scroll, zoom]);
  const seek = (clientX: number) => {
    const rect = canvas.current?.getBoundingClientRect();
    if (rect)
      onScrub(
        Math.max(
          0,
          Math.min(project.duration, (clientX - rect.left + scroll) / zoom),
        ),
      );
  };
  const end = (id: number) => {
    if (dragging.current === id) {
      dragging.current = null;
      onEnd();
    }
  };
  return (
    <div className={styles.ruler}>
      <canvas ref={canvas} style={{ width }} aria-hidden="true" />
      <div
        className={styles.rulerHit}
        role="slider"
        tabIndex={0}
        aria-label="timeline scrubber"
        aria-valuemin={0}
        aria-valuemax={project.duration}
        aria-valuenow={Math.min(project.duration, playhead)}
        onPointerDown={(e) => {
          if (e.button !== 0 || dragging.current !== null) return;
          dragging.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          onStart();
          seek(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current === e.pointerId) seek(e.clientX);
        }}
        onPointerUp={(e) => {
          end(e.pointerId);
        }}
        onPointerCancel={(e) => end(e.pointerId)}
        onLostPointerCapture={(e) => end(e.pointerId)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            onStart();
            onScrub(
              Math.max(
                0,
                Math.min(
                  project.duration,
                  playhead + (e.key === 'ArrowLeft' ? -1 : 1) / project.fps,
                ),
              ),
            );
            onEnd();
          }
        }}
      />
      {project.markers
        .filter(
          (m) => m.time * zoom >= scroll && m.time * zoom <= scroll + width,
        )
        .map((marker) => (
          <button
            type="button"
            key={marker.id}
            className={styles.marker}
            data-agent={markerOrigins?.[marker.id] === 'agent' || undefined}
            style={{ left: marker.time * zoom - scroll }}
            title={marker.label}
            aria-label={`${marker.label}, ${timecode(marker.time)}`}
            onClick={() => {
              onStart();
              onScrub(marker.time);
              onEnd();
            }}
          />
        ))}
    </div>
  );
}
