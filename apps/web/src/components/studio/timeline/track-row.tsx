'use client';
import * as React from 'react';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  Lock,
  Unlock,
  Music,
  Mic,
  Type,
  Volume2,
  VolumeX,
  Blend,
  LoaderCircle,
} from 'lucide-react';
import type { Clip, Op, Track } from '@kimo/client';
import { clipLabel } from '@/lib/editing/display';
import { trimClip } from '@/lib/editing/commands';
import { canvasBounds, rowHeight, timecode, visibleClips } from './geometry';
import { drawTrack, readPalette } from './draw-track';
import { AgentClipMotion } from './animation';
import { transitionChips } from './transitions';
import type { TimelineMediaCache } from './media-cache';
import type { TimelineEditorProps } from './types';
import styles from './timeline.module.css';
interface TrackRowProps extends Pick<
  TimelineEditorProps,
  | 'project'
  | 'assets'
  | 'editing'
  | 'selection'
  | 'setSelection'
  | 'activeClipId'
  | 'agentChange'
  | 'onSelectTrack'
  | 'onOpenText'
  | 'InlineTextEditor'
> {
  track: Track;
  width: number;
  scroll: number;
  zoom: number;
  media?: TimelineMediaCache;
  mediaRevision: number;
  onPointer: (e: ReactPointerEvent<HTMLDivElement>, clip?: Clip) => void;
  onContext: (e: ReactMouseEvent, clip: Clip) => void;
  onDropAsset: (assetId: string, track: Track, clientX: number) => void;
  onError: (message: string) => void;
  onRevealClip: (clip: Clip) => void;
}
export function TrackRow(props: TrackRowProps) {
  const {
    track,
    project,
    selection,
    assets,
    width,
    scroll,
    zoom,
    media,
    mediaRevision,
  } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const motion = useRef(new AgentClipMotion());
  const previous = useRef<Clip[]>([]);
  const glow = useRef<{ id: string | null; ended?: number }>({
    id: props.activeClipId ?? null,
  });
  const lastAgent = useRef<string | undefined>(undefined);
  const [hover, setHover] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const [rename, setRename] = useState(false);
  const [inline, setInline] = useState<string>();
  const clips = Object.values(project.clips)
    .filter((c) => c.trackId === track.id)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const visible = visibleClips(clips, scroll, width, zoom);
  const height = rowHeight(track.kind);
  const origin = Math.max(0, scroll - width);
  const bounds = canvasBounds(
    width,
    typeof window === 'undefined' ? 1 : window.devicePixelRatio,
  );
  useEffect(() => {
    const node = canvas.current;
    const ctx = node?.getContext('2d');
    if (!ctx || !node) return;
    node.width = bounds.width * bounds.ratio;
    node.height = height * bounds.ratio;
    ctx.setTransform(bounds.ratio, 0, 0, bounds.ratio, 0, 0);
    if (props.agentChange && props.agentChange.id !== lastAgent.current) {
      motion.current.apply(
        previous.current,
        clips,
        props.agentChange.ops,
        performance.now(),
      );
      lastAgent.current = props.agentChange.id;
    }
    previous.current = clips;
    const durationStyle = window.getComputedStyle(node);
    const fadeDuration =
      parseFloat(durationStyle.getPropertyValue('--timeline-ai-fade')) || 600;
    motion.current.deleteDuration =
      parseFloat(durationStyle.getPropertyValue('--timeline-delete')) || 220;
    if (props.activeClipId) glow.current = { id: props.activeClipId };
    else if (glow.current.id && glow.current.ended === undefined)
      glow.current.ended = performance.now();
    const reduced =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const palette = readPalette(node);
    let frame: number | undefined;
    let last = performance.now();
    const draw = (now: number) => {
      const visuals = motion.current.frame(now, now - last, reduced);
      const fade =
        glow.current.ended === undefined
          ? 1
          : Math.max(0, 1 - (now - glow.current.ended) / fadeDuration);
      if (fade === 0) glow.current.id = null;
      last = now;
      drawTrack(ctx, {
        clips: visible,
        track,
        assets,
        width: bounds.width,
        height,
        origin,
        zoom,
        palette,
        selection,
        hover,
        active: glow.current.id,
        activeOpacity: fade,
        media,
        visuals,
        domLabels: new Set([
          ...selection,
          ...(hover ? [hover] : []),
          ...(focused ? [focused] : []),
          ...(inline ? [inline] : []),
        ]),
        editingTextId: inline,
      });
      if (
        motion.current.active ||
        (glow.current.id && glow.current.ended !== undefined)
      )
        frame = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [
    project,
    assets,
    track,
    width,
    height,
    origin,
    zoom,
    selection,
    hover,
    media,
    mediaRevision,
    bounds.width,
    bounds.ratio,
    props.activeClipId,
    visible,
  ]);
  const edit = (ops: Op[], label: string) => {
    void props.editing
      .editGroup(ops, label, 'timeline')
      .then((result) => {
        if (result.status === 'failed')
          props.onError(result.error ?? 'Edit unavailable');
      })
      .catch((error: unknown) =>
        props.onError(
          error instanceof Error ? error.message : 'Edit unavailable',
        ),
      );
  };
  const icon =
    track.kind === 'text'
      ? Type
      : track.kind === 'audio'
        ? clips.some((c) => c.audioRole === 'voice')
          ? Mic
          : Music
        : track.kind === 'overlay'
          ? ImageIcon
          : Film;
  const Icon = icon;
  const roving =
    focused && clips.some((c) => c.id === focused)
      ? focused
      : (clips.find((c) => selection.includes(c.id))?.id ?? clips[0]?.id);
  const toggle = (key: 'hidden' | 'muted' | 'locked') =>
    edit(
      [{ op: 'track.update', id: track.id, patch: { [key]: !track[key] } }],
      `${key} track`,
    );
  return (
    <div
      role="row"
      className={styles.row}
      data-track-id={track.id}
      data-hidden={track.hidden || undefined}
      style={{ height }}
    >
      <div className={styles.header} role="rowheader">
        <Icon size={24} aria-hidden="true" />
        {rename ? (
          <input
            aria-label="track name"
            ref={(node) => node?.focus()}
            defaultValue={track.name}
            onBlur={(e) => {
              const name = e.currentTarget.value.trim();
              setRename(false);
              if (name && name !== track.name)
                edit(
                  [{ op: 'track.update', id: track.id, patch: { name } }],
                  'rename track',
                );
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                e.currentTarget.value = track.name;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={styles.trackName}
            aria-label={`rename ${track.name}`}
            disabled={track.locked}
            onClick={() => props.onSelectTrack?.(track.id)}
            onDoubleClick={() => setRename(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && props.onSelectTrack) {
                e.preventDefault();
                props.onSelectTrack(track.id);
              } else if (e.key === 'Enter' || e.key === 'F2') {
                e.preventDefault();
                setRename(true);
              }
            }}
          >
            {track.name}
          </button>
        )}
        <div className={styles.trackToggles}>
          <button
            type="button"
            aria-label={`${track.hidden ? 'show' : 'hide'} ${track.name}`}
            aria-pressed={track.hidden}
            disabled={track.locked}
            onClick={() => toggle('hidden')}
          >
            {track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          {track.kind === 'audio' ? (
            <button
              type="button"
              aria-label={`${track.muted ? 'unmute' : 'mute'} ${track.name}`}
              aria-pressed={track.muted}
              disabled={track.locked}
              onClick={() => toggle('muted')}
            >
              {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={`${track.locked ? 'unlock' : 'lock'} ${track.name}`}
            aria-pressed={track.locked}
            onClick={() => toggle('locked')}
          >
            {track.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
        </div>
      </div>
      <div
        className={styles.rowSurface}
        data-track-surface={track.id}
        role="gridcell"
        tabIndex={-1}
        aria-label={`${track.name} clips`}
        onPointerDown={(e) => props.onPointer(e)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const time = (e.clientX - rect.left) / zoom;
          setHover(
            [...clips]
              .reverse()
              .find((c) => time >= c.start && time < c.start + c.duration)?.id,
          );
        }}
        onPointerLeave={() => setHover(undefined)}
        onDoubleClick={(e) => {
          if (
            e.target instanceof HTMLElement &&
            e.target.closest('input,textarea,[contenteditable=true]')
          )
            return;
          const time =
            (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom;
          const clip = clips.find(
            (c) => time >= c.start && time < c.start + c.duration,
          );
          if (clip?.kind === 'text' && !clip.locked && !track.locked) {
            if (props.InlineTextEditor) setInline(clip.id);
            else props.onOpenText(clip.id);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          e.preventDefault();
          props.onDropAsset(
            e.dataTransfer.getData('application/x-kimo-asset'),
            track,
            e.clientX,
          );
        }}
      >
        <canvas
          ref={canvas}
          className={styles.trackCanvas}
          style={{ left: origin, width: bounds.width, height }}
          aria-hidden="true"
        />
        {clips.map((clip, index) => (
          <button
            key={clip.id}
            type="button"
            className={styles.proxy}
            data-clip-proxy={clip.id}
            data-active={props.activeClipId === clip.id || undefined}
            tabIndex={clip.id === roving ? 0 : -1}
            aria-pressed={selection.includes(clip.id)}
            aria-label={`${clipLabel(clip, assets)}, ${clip.kind}, starts ${timecode(clip.start)}, ${Number(clip.duration.toFixed(2))} seconds${clip.locked ? ', locked' : ''}`}
            onBlur={() => setFocused(undefined)}
            onFocus={() => {
              setFocused(clip.id);
              props.onRevealClip(clip);
            }}
            onClick={(e) => {
              props.setSelection(
                e.shiftKey ? [...new Set([...selection, clip.id])] : [clip.id],
              );
            }}
            onContextMenu={(e) => props.onContext(e, clip)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                const next =
                  clips[
                    Math.max(
                      0,
                      Math.min(
                        clips.length - 1,
                        index + (e.key === 'ArrowLeft' ? -1 : 1),
                      ),
                    )
                  ];
                if (next) {
                  setFocused(next.id);
                  const buttons =
                    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      '[data-clip-proxy]',
                    );
                  buttons?.[clips.indexOf(next)]?.focus();
                }
              }
            }}
          />
        ))}
        {visible
          .filter(
            (clip) =>
              selection.includes(clip.id) ||
              hover === clip.id ||
              focused === clip.id ||
              inline === clip.id,
          )
          .map((clip) => (
            <div
              key={clip.id}
              className={styles.overlay}
              data-selected={selection.includes(clip.id) || undefined}
              data-focused={focused === clip.id || undefined}
              data-active={props.activeClipId === clip.id || undefined}
              style={{ left: clip.start * zoom, width: clip.duration * zoom }}
            >
              <div
                role="button"
                tabIndex={-1}
                className={styles.overlayLabel}
                aria-label={clipLabel(clip, assets)}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  props.onPointer(e, clip);
                }}
                onContextMenu={(e) => props.onContext(e, clip)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (clip.kind === 'text' && !clip.locked && !track.locked) {
                    if (props.InlineTextEditor) setInline(clip.id);
                    else props.onOpenText(clip.id);
                  } else props.setSelection([clip.id]);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && clip.kind === 'text')
                    props.onOpenText(clip.id);
                }}
              >
                <span>{clipLabel(clip, assets)}</span>
                {clip.speed !== 1 ? (
                  <span className={styles.speedBadge}>{clip.speed}×</span>
                ) : null}
                {clip.locked ? <Lock size={10} aria-label="locked" /> : null}
                <button
                  type="button"
                  className={styles.clipLock}
                  aria-label={`${clip.locked ? 'unlock' : 'lock'} ${clipLabel(clip, assets)}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() =>
                    edit(
                      [
                        {
                          op: 'clip.update',
                          id: clip.id,
                          patch: { locked: !clip.locked },
                        },
                      ],
                      'lock clip',
                    )
                  }
                >
                  <Lock size={10} />
                </button>
                {props.activeClipId === clip.id ? (
                  <LoaderCircle
                    size={14}
                    className={styles.spinner}
                    aria-label="kimo is editing this clip"
                  />
                ) : null}
              </div>
              {selection.includes(clip.id) && !clip.locked && !track.locked
                ? (['in', 'out'] as const).map((edge) => (
                    <div
                      key={edge}
                      role="slider"
                      aria-valuemin={0}
                      aria-valuemax={clip.in + clip.duration * clip.speed}
                      aria-valuenow={
                        edge === 'in'
                          ? clip.in
                          : clip.in + clip.duration * clip.speed
                      }
                      tabIndex={0}
                      aria-label={`trim ${edge} ${clipLabel(clip, assets)}`}
                      aria-orientation="horizontal"
                      className={`${styles.handle} ${edge === 'in' ? styles.handleIn : styles.handleOut}`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        props.onPointer(e, clip);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') e.currentTarget.blur();
                        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                          e.preventDefault();
                          e.stopPropagation();
                          const value =
                            (edge === 'in'
                              ? clip.in
                              : clip.in + clip.duration * clip.speed) +
                            ((e.key === 'ArrowLeft' ? -1 : 1) *
                              (e.shiftKey ? 10 : 1) *
                              clip.speed) /
                              project.fps;
                          try {
                            edit(
                              trimClip(project, clip.id, edge, value, {
                                assets,
                              }),
                              'trim clip',
                            );
                          } catch (error) {
                            props.onError(
                              error instanceof Error
                                ? error.message
                                : 'Edit unavailable',
                            );
                          }
                        }
                      }}
                    />
                  ))
                : null}
              {inline === clip.id && props.InlineTextEditor ? (
                <div
                  className={styles.inlineText}
                  onPointerDown={(e) => e.stopPropagation()}
                  role="presentation"
                >
                  <props.InlineTextEditor
                    clip={clip}
                    editing={props.editing}
                    onClose={() => setInline(undefined)}
                  />
                </div>
              ) : null}
            </div>
          ))}
        {transitionChips(visible, project.fps).map((chip) => (
          <button
            key={`${chip.clipId}:${chip.at}`}
            type="button"
            className={styles.transition}
            style={{ left: chip.at * zoom }}
            title={chip.label}
            aria-label={`inspect ${chip.label}`}
            onClick={() => props.setSelection([chip.clipId])}
          >
            <Blend size={12} />
          </button>
        ))}
      </div>
    </div>
  );
}
