'use client';
import * as React from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { FolderOpen } from 'lucide-react';
import {
  applyOps,
  type Asset,
  type Clip,
  type Op,
  type Track,
} from '@kimo/client';
import {
  deleteClips,
  detachAudio,
  duplicateClips,
  moveClips,
  slipClip,
  splitClips,
  trackAccepts,
  trimClip,
  validateCommands,
} from '@/lib/editing/commands';
import { clipLabel, displayTracks } from '@/lib/editing/display';
import { AssetsDrawer } from './assets-drawer';
import {
  clampZoom,
  edgeAt,
  fitZoom,
  HEADER_WIDTH,
  hitClip,
  linkedSelection,
  rowHeight,
  selectClip,
  snapDelta,
  snapTime,
  sourceClock,
  timecode,
  visibleClips,
} from './geometry';
import { TimelineGesture } from './gesture';
import { TimelineMediaCache } from './media-cache';
import { TimelineRuler } from './ruler';
import { TrackRow } from './track-row';
import type { TimelineEditorProps } from './types';
import styles from './timeline.module.css';
interface Drag {
  pointer: number;
  gesture: TimelineGesture;
  clip: Clip;
  ids: string[];
  x: number;
  time: number;
  edge: 'in' | 'out' | null;
  ripple: boolean;
  slip: boolean;
  duplicateOps: Op[];
}
interface Marquee {
  pointer: number;
  x: number;
  y: number;
  endX: number;
  endY: number;
  initial: readonly string[];
}
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Edit unavailable';
const editableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest(
    'input,textarea,select,[contenteditable="true"],[role="textbox"]',
  );
export function TimelineEditor(props: TimelineEditorProps) {
  const {
    project,
    assets,
    editing,
    selection,
    playhead,
    tool,
    snapping,
    linked,
  } = props;
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [scroll, setScroll] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [mediaRevision, setMediaRevision] = useState(0);
  const [localOpen, setLocalOpen] = useState(false);
  const [aiLinger, setAiLinger] = useState(false);
  useEffect(() => {
    if (props.activeClipId) {
      setAiLinger(true);
      return;
    }
    const duration = root.current
      ? parseFloat(
          window
            .getComputedStyle(root.current)
            .getPropertyValue('--timeline-ai-fade'),
        ) || 600
      : 600;
    const timer = setTimeout(() => setAiLinger(false), duration);
    return () => clearTimeout(timer);
  }, [props.activeClipId]);
  const [menu, setMenu] = useState<{ clip: string; x: number; y: number }>();
  const [guide, setGuide] = useState<number>();
  const [trimHint, setTrimHint] = useState<string>();
  const [marquee, setMarquee] = useState<Marquee>();
  const drag = useRef<Drag | null>(null);
  const headDrag = useRef<number | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const originFocus = useRef<HTMLElement | null>(null);
  const zoom =
    props.zoom === null
      ? fitZoom(width, project.duration)
      : clampZoom(props.zoom);
  const trackWidth = Math.max(1, width - HEADER_WIDTH);
  const contentWidth =
    HEADER_WIDTH + Math.max(trackWidth, project.duration * 1.1 * zoom);
  const tracks = useMemo(() => displayTracks(project), [project]);
  const rows = tracks.map((track, index) => ({
    track,
    top: tracks.slice(0, index).reduce((sum, t) => sum + rowHeight(t.kind), 0),
  }));
  const totalHeight = tracks.reduce((sum, t) => sum + rowHeight(t.kind), 0);
  const activeRows = rows.filter(
    ({ top, track }) =>
      top + rowHeight(track.kind) >= viewport.top - viewport.height &&
      top <= viewport.top + viewport.height * 2,
  );
  const media = useMemo(
    () =>
      props.mediaHandle
        ? new TimelineMediaCache(props.mediaHandle, () =>
            setMediaRevision((n) => n + 1),
          )
        : undefined,
    [props.mediaHandle],
  );
  useEffect(() => () => media?.dispose(), [media]);
  useEffect(() => {
    if (!media) return;
    const requests: { clip: Clip; width: number }[] = [];
    const keys = new Set<string>();
    for (const { track } of activeRows)
      for (const clip of visibleClips(
        Object.values(project.clips).filter((c) => c.trackId === track.id),
        scroll,
        trackWidth,
        zoom,
      )) {
        const requestWidth = Math.max(80, Math.min(1280, clip.duration * zoom));
        keys.add(media.key(clip, requestWidth));
        requests.push({ clip, width: requestWidth });
      }
    media.retain(keys);
    const center = (scroll + trackWidth / 2) / zoom;
    requests.sort(
      (a, b) =>
        Math.abs(a.clip.start + a.clip.duration / 2 - center) -
          Math.abs(b.clip.start + b.clip.duration / 2 - center) ||
        a.clip.id.localeCompare(b.clip.id),
    );
    for (const request of requests) media.request(request.clip, request.width);
  }, [project, scroll, trackWidth, zoom, media, activeRows]);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const update = () => {
      setWidth(node.clientWidth);
      if (scroller.current)
        setViewport({
          top: scroller.current.scrollTop,
          height: scroller.current.clientHeight,
        });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () => () => {
      drag.current?.gesture.cancel();
      drag.current = null;
      if (headDrag.current !== null) {
        headDrag.current = null;
        latest.current.onScrubEnd();
      }
    },
    [project.id, editing],
  );
  useEffect(() => {
    const current = drag.current;
    if (current && !project.clips[current.clip.id]) {
      current.gesture.cancel();
      drag.current = null;
      setGuide(undefined);
      setTrimHint(undefined);
    }
  }, [project]);
  const report = useCallback(
    (message: string) => latest.current.onError?.(message),
    [],
  );
  const group = (ops: readonly Op[], label: string) => {
    if (!ops.length) return;
    try {
      const checked = validateCommands(project, ops, assets);
      void editing
        .editGroup(checked, label, 'timeline')
        .then((result) => {
          if (result.status === 'failed')
            report(result.error ?? 'Edit unavailable');
        })
        .catch((error: unknown) => report(errorText(error)));
    } catch (error) {
      report(errorText(error));
    }
  };
  const attempt = (operation: () => Op[], label: string) => {
    try {
      group(operation(), label);
    } catch (error) {
      report(errorText(error));
    }
  };
  const timeAt = (clientX: number) => {
    const rect = scroller.current?.getBoundingClientRect();
    return Math.max(
      0,
      (clientX -
        (rect?.left ?? 0) -
        HEADER_WIDTH +
        (scroller.current?.scrollLeft ?? 0)) /
        zoom,
    );
  };
  const targetTrackAt = (clientY: number) => {
    const rect = scroller.current?.getBoundingClientRect();
    const y = clientY - (rect?.top ?? 0) + (scroller.current?.scrollTop ?? 0);
    return rows.find(
      ({ track, top }) => y >= top && y < top + rowHeight(track.kind),
    )?.track;
  };
  const addText = (track?: Track) => {
    const target =
      track?.kind === 'text'
        ? track
        : tracks.find((t) => t.kind === 'text' && !t.locked);
    if (target?.locked) return;
    const trackId = target?.id ?? crypto.randomUUID();
    const id = crypto.randomUUID();
    const clip: Clip = {
      id,
      trackId,
      kind: 'text',
      start: Math.round(playhead * project.fps) / project.fps,
      duration: 3,
      in: 0,
      speed: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      effects: [],
      keyframes: [],
      text: { style: 'caption-clean', content: 'your text' },
    };
    const ops: Op[] = [
      ...(target
        ? []
        : [
            {
              op: 'track.add' as const,
              track: {
                id: trackId,
                kind: 'text' as const,
                name: 'text',
                height: 48 as const,
                hidden: false,
                muted: false,
                locked: false,
              },
            },
          ]),
      { op: 'clip.add', clip },
    ];
    try {
      validateCommands(project, ops, assets);
      const result = editing.editGroup(ops, 'add text', 'timeline');
      props.setSelection([id]);
      props.onOpenText(id);
      void result
        .then((result) => {
          if (result.status === 'failed' || result.status === 'cancelled')
            report(result.error ?? 'Text unavailable');
        })
        .catch((error: unknown) => report(errorText(error)));
    } catch (error) {
      report(errorText(error));
    }
  };
  const insertAsset = (asset: Asset, target?: Track, at = playhead) => {
    if (asset.kind === 'doc') return;
    const targetKind =
      asset.kind === 'audio'
        ? 'audio'
        : asset.kind === 'image'
          ? 'overlay'
          : 'video';
    const track =
      target ?? tracks.find((t) => t.kind === targetKind && !t.locked);
    if (!track || track.locked) {
      report('Choose an unlocked compatible track');
      return;
    }
    const clip: Clip = {
      id: crypto.randomUUID(),
      kind: asset.kind,
      assetId: asset.id,
      trackId: track.id,
      start: Math.round(at * project.fps) / project.fps,
      duration: asset.kind === 'image' ? 3 : (asset.durationSec ?? 0),
      in: 0,
      speed: 1,
      effects: [],
      keyframes: [],
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    };
    if (!trackAccepts(track, clip)) {
      report('Clip and track kinds must match');
      return;
    }
    group([{ op: 'clip.add', clip }], 'add asset');
    props.setSelection([clip.id]);
  };
  const pointerStart = (
    e: ReactPointerEvent<HTMLDivElement>,
    supplied?: Clip,
  ) => {
    if (
      e.button !== 0 ||
      drag.current ||
      marqueeRef.current ||
      editableTarget(e.target)
    )
      return;
    const track = targetTrackAt(e.clientY);
    if (!track) return;
    root.current?.focus({ preventScroll: true });
    const time = timeAt(e.clientX);
    const clip =
      supplied ??
      hitClip(
        Object.values(project.clips).filter((c) => c.trackId === track.id),
        time,
      );
    if (tool === 'text') {
      if (track.kind === 'text') addText(track);
      return;
    }
    if (tool === 'blade') {
      if (clip)
        attempt(() => splitClips(project, [clip.id], time), 'split clip');
      return;
    }
    setMenu(undefined);
    if (!clip) {
      const rect = scroller.current?.getBoundingClientRect();
      const start: Marquee = {
        pointer: e.pointerId,
        x: e.clientX - (rect?.left ?? 0) + scroll,
        y: e.clientY - (rect?.top ?? 0) + viewport.top,
        endX: e.clientX - (rect?.left ?? 0) + scroll,
        endY: e.clientY - (rect?.top ?? 0) + viewport.top,
        initial: e.shiftKey ? selection : [],
      };
      marqueeRef.current = start;
      setMarquee(start);
      if (!e.shiftKey) props.setSelection([]);
      root.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const ids = linkedSelection(
      project,
      e.shiftKey
        ? selectClip(selection, clip.id, true)
        : selection.includes(clip.id)
          ? selection
          : [clip.id],
      linked,
    );
    props.setSelection(ids);
    if (
      e.shiftKey ||
      clip.locked ||
      track.locked ||
      ids.some(
        (id) =>
          project.clips[id]?.locked ||
          tracks.find((t) => t.id === project.clips[id]?.trackId)?.locked,
      )
    )
      return;
    const edge = tool === 'slip' ? null : edgeAt(clip, time, zoom);
    try {
      const gesture = new TimelineGesture(
        project,
        editing,
        ids,
        edge
          ? 'trim clip'
          : tool === 'slip'
            ? 'slip clip'
            : e.altKey
              ? 'duplicate clips'
              : 'move clips',
      );
      const duplicateOps =
        e.altKey && !edge && tool !== 'slip'
          ? duplicateClips(project, ids, () => crypto.randomUUID(), 0)
          : [];
      drag.current = {
        pointer: e.pointerId,
        gesture,
        clip,
        ids,
        x: e.clientX,
        time,
        edge,
        ripple: e.metaKey || e.ctrlKey,
        slip: tool === 'slip',
        duplicateOps,
      };
      root.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
    } catch (error) {
      report(errorText(error));
    }
  };
  const pointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const mar = marqueeRef.current;
    if (mar?.pointer === e.pointerId) {
      const rect = scroller.current?.getBoundingClientRect();
      const next = {
        ...mar,
        endX: e.clientX - (rect?.left ?? 0) + scroll,
        endY: e.clientY - (rect?.top ?? 0) + viewport.top,
      };
      marqueeRef.current = next;
      setMarquee(next);
      const left = (Math.min(next.x, next.endX) - HEADER_WIDTH) / zoom;
      const right = (Math.max(next.x, next.endX) - HEADER_WIDTH) / zoom;
      const top = Math.min(next.y, next.endY);
      const bottom = Math.max(next.y, next.endY);
      const intersectTracks = new Set(
        rows
          .filter(
            (r) => r.top < bottom && r.top + rowHeight(r.track.kind) > top,
          )
          .map((r) => r.track.id),
      );
      props.setSelection([
        ...new Set([
          ...next.initial,
          ...Object.values(project.clips)
            .filter(
              (c) =>
                intersectTracks.has(c.trackId) &&
                c.start <= right &&
                c.start + c.duration >= left,
            )
            .map((c) => c.id),
        ]),
      ]);
      return;
    }
    const current = drag.current;
    if (!current || current.pointer !== e.pointerId) return;
    const baseline = current.gesture.baseline;
    let delta = (e.clientX - current.x) / zoom;
    try {
      let ops: Op[];
      if (current.edge) {
        const baselineTime =
          current.edge === 'in'
            ? current.clip.start
            : current.clip.start + current.clip.duration;
        const snapped = snapping
          ? snapTime(
              baseline,
              baselineTime + delta,
              zoom,
              current.ids,
              playhead,
              props.beats,
            )
          : { time: baselineTime + delta, guide: undefined };
        setGuide(snapped.guide);
        ops = trimClip(
          baseline,
          current.clip.id,
          current.edge,
          sourceClock(current.clip, snapped.time),
          { ripple: current.ripple, assets },
        );
        const preview = applyOps(baseline, ops, baseline.version).clips[
          current.clip.id
        ];
        if (preview)
          setTrimHint(
            `${preview.in.toFixed(2)} / ${(preview.in + preview.duration * preview.speed).toFixed(2)} · ${preview.duration.toFixed(2)}s`,
          );
      } else if (current.slip) {
        ops = slipClip(
          baseline,
          current.clip.id,
          current.clip.in + delta * current.clip.speed,
          assets,
        );
      } else {
        const snap = snapping
          ? snapDelta(baseline, current.ids, delta, zoom, playhead, props.beats)
          : { delta, guide: undefined };
        delta = snap.delta;
        setGuide(snap.guide);
        const target = targetTrackAt(e.clientY);
        const source = baseline.tracks.find(
          (t) => t.id === current.clip.trackId,
        );
        const trackId =
          target &&
          !target.locked &&
          target.kind === source?.kind &&
          target.id !== source.id &&
          current.ids.every(
            (id) =>
              baseline.tracks.find((t) => t.id === baseline.clips[id]?.trackId)
                ?.kind === target.kind,
          )
            ? target.id
            : undefined;
        if (current.duplicateOps.length) {
          const copied = applyOps(
            baseline,
            current.duplicateOps,
            baseline.version,
          );
          const ids = current.duplicateOps.flatMap((op) =>
            op.op === 'clip.add' ? [op.clip.id] : [],
          );
          ops = [
            ...current.duplicateOps,
            ...moveClips(copied, ids, delta, trackId),
          ];
        } else ops = moveClips(baseline, current.ids, delta, trackId);
      }
      current.gesture.preview(validateCommands(baseline, ops, assets));
    } catch (error) {
      setTrimHint(errorText(error));
    }
  };
  const endPointer = (pointer: number, cancel: boolean) => {
    if (marqueeRef.current?.pointer === pointer) {
      marqueeRef.current = null;
      setMarquee(undefined);
    }
    const current = drag.current;
    if (!current || current.pointer !== pointer) return;
    drag.current = null;
    setGuide(undefined);
    setTrimHint(undefined);
    if (cancel) current.gesture.cancel();
    else
      void current.gesture
        .finish()
        ?.then((result) => {
          if (result.status === 'failed')
            report(result.error ?? 'Edit unavailable');
        })
        .catch((error: unknown) => report(errorText(error)));
  };
  const context = (e: ReactMouseEvent, clip: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selection.includes(clip.id)) props.setSelection([clip.id]);
    const rect = root.current?.getBoundingClientRect();
    originFocus.current = e.target instanceof HTMLElement ? e.target : null;
    setMenu({
      clip: clip.id,
      x: Math.max(0, Math.min(width - 240, e.clientX - (rect?.left ?? 0))),
      y: Math.max(0, e.clientY - (rect?.top ?? 0)),
    });
  };
  const closeMenu = () => {
    setMenu(undefined);
    originFocus.current?.focus();
  };
  useEffect(() => {
    if (menu)
      menuRef.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus();
  }, [menu]);
  const keyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editableTarget(e.target) || e.nativeEvent.isComposing || menu) return;
    if (
      e.target instanceof HTMLElement &&
      e.target.closest('button:not([data-clip-proxy])')
    )
      return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      if (drag.current) endPointer(drag.current.pointer, true);
      if (marqueeRef.current) endPointer(marqueeRef.current.pointer, true);
      return;
    }
    let handled = true;
    if (mod && e.key.toLowerCase() === 'b')
      attempt(() => splitClips(project, selection, playhead), 'split clips');
    else if (mod && e.key.toLowerCase() === 't') addText();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length)
      attempt(
        () => deleteClips(project, selection, { lift: e.shiftKey }),
        'delete clips',
      );
    else if ((e.key === ',' || e.key === '.') && selection.length)
      attempt(
        () =>
          moveClips(
            project,
            selection,
            ((e.key === ',' ? -1 : 1) * (e.shiftKey ? 10 : 1)) / project.fps,
          ),
        'nudge clips',
      );
    else if ((e.key === '[' || e.key === ']') && selection.length)
      attempt(
        () =>
          selection.flatMap((id) => {
            const c = project.clips[id];
            return c
              ? trimClip(
                  project,
                  id,
                  e.key === '[' ? 'in' : 'out',
                  sourceClock(c, playhead),
                  { assets },
                )
              : [];
          }),
        'trim clips',
      );
    else if (!mod && e.key.toLowerCase() === 'l' && selection.length)
      group(
        selection.map((id) => ({
          op: 'clip.update',
          id,
          patch: { locked: !project.clips[id]?.locked },
        })),
        'lock clips',
      );
    else if (mod && e.key.toLowerCase() === 'z')
      void (e.shiftKey ? editing.redoUser() : editing.undoUser()).catch(
        (error: unknown) => report(errorText(error)),
      );
    else if (e.key === ' ' && props.onTogglePlayback) props.onTogglePlayback();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const menuClip = menu ? project.clips[menu.clip] : undefined;
  const menuLocked =
    !!menuClip &&
    (menuClip.locked || tracks.find((t) => t.id === menuClip.trackId)?.locked);
  const open = props.assetsOpen ?? localOpen;
  return (
    <div
      ref={root}
      className={styles.timeline}
      data-ai-treatment={!!props.activeClipId || aiLinger || undefined}
      role="grid"
      aria-label="timeline editor"
      tabIndex={0}
      onKeyDown={keyDown}
      onPointerMove={pointerMove}
      onPointerUp={(e) => {
        if (drag.current?.pointer === e.pointerId) pointerMove(e);
        endPointer(e.pointerId, false);
      }}
      onPointerCancel={(e) => endPointer(e.pointerId, true)}
      onLostPointerCapture={(e) => endPointer(e.pointerId, true)}
      onContextMenu={(e) => {
        const track = targetTrackAt(e.clientY);
        const clip = track
          ? hitClip(
              Object.values(project.clips).filter(
                (c) => c.trackId === track.id,
              ),
              timeAt(e.clientX),
            )
          : undefined;
        if (clip) context(e, clip);
      }}
    >
      {open ? (
        <AssetsDrawer
          assets={assets}
          onUpload={props.onUpload}
          onInsert={(asset) => insertAsset(asset)}
          onError={report}
        />
      ) : null}
      <div className={styles.rulerRow}>
        <div className={styles.rulerHeader} />
        <TimelineRuler
          project={project}
          playhead={playhead}
          markerOrigins={props.markerOrigins}
          width={trackWidth}
          scroll={scroll}
          zoom={zoom}
          onStart={props.onScrubStart}
          onScrub={props.onScrub}
          onEnd={props.onScrubEnd}
        />
      </div>
      <div
        ref={scroller}
        className={styles.scroller}
        onScroll={(e) => {
          setScroll(e.currentTarget.scrollLeft);
          setViewport({
            top: e.currentTarget.scrollTop,
            height: e.currentTarget.clientHeight,
          });
        }}
      >
        <div
          className={styles.content}
          style={{ width: contentWidth, height: totalHeight }}
        >
          {activeRows.map(({ track, top }) => (
            <div
              key={track.id}
              className={styles.positionedRow}
              style={{ top }}
            >
              <TrackRow
                project={project}
                beats={props.beats}
                assets={assets}
                editing={editing}
                selection={selection}
                setSelection={props.setSelection}
                activeClipId={props.activeClipId}
                agentChange={props.agentChange}
                onSelectTrack={props.onSelectTrack}
                onOpenText={props.onOpenText}
                InlineTextEditor={props.InlineTextEditor}
                track={track}
                width={trackWidth}
                scroll={scroll}
                zoom={zoom}
                media={media}
                mediaRevision={mediaRevision}
                onPointer={pointerStart}
                onContext={context}
                onDropAsset={(id, target, x) => {
                  const asset = assets.find((a) => a.id === id);
                  if (asset) insertAsset(asset, target, timeAt(x));
                }}
                onRevealClip={(clip) => {
                  const node = scroller.current;
                  if (!node) return;
                  const left = clip.start * zoom;
                  const right = (clip.start + clip.duration) * zoom;
                  if (left < scroll || right > scroll + trackWidth) {
                    const next =
                      left < scroll ? left : Math.min(left, right - trackWidth);
                    node.scrollLeft = Math.max(0, next);
                    setScroll(node.scrollLeft);
                  }
                }}
                onError={report}
              />
            </div>
          ))}
          {guide !== undefined ? (
            <div
              className={styles.snapLine}
              style={{ left: HEADER_WIDTH + guide * zoom }}
            />
          ) : null}
          {marquee ? (
            <div
              className={styles.marquee}
              style={{
                left: Math.min(marquee.x, marquee.endX),
                top: Math.min(marquee.y, marquee.endY),
                width: Math.abs(marquee.endX - marquee.x),
                height: Math.abs(marquee.endY - marquee.y),
              }}
            />
          ) : null}
        </div>
      </div>
      <div
        className={styles.playhead}
        data-follow={
          (props.followKimo &&
            props.activeClipId &&
            headDrag.current === null) ||
          undefined
        }
        style={{
          left: HEADER_WIDTH + playhead * zoom - scroll,
          top: open ? 'var(--timeline-drawer)' : 0,
          bottom: 'var(--control-md)',
          visibility:
            playhead * zoom < scroll || playhead * zoom > scroll + trackWidth
              ? 'hidden'
              : 'visible',
        }}
        aria-hidden="true"
      >
        <span />
      </div>
      <button
        type="button"
        className={styles.playheadHit}
        style={{
          left: HEADER_WIDTH + playhead * zoom - scroll,
          top: open ? 'var(--timeline-drawer)' : 0,
          visibility:
            playhead * zoom < scroll || playhead * zoom > scroll + trackWidth
              ? 'hidden'
              : 'visible',
        }}
        aria-label={`playhead ${timecode(playhead)}`}
        onPointerDown={(e) => {
          if (e.button !== 0 || headDrag.current !== null) return;
          headDrag.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          props.onScrubStart();
        }}
        onPointerMove={(e) => {
          if (headDrag.current === e.pointerId)
            props.onScrub(Math.min(project.duration, timeAt(e.clientX)));
        }}
        onPointerUp={(e) => {
          if (headDrag.current === e.pointerId) {
            headDrag.current = null;
            props.onScrubEnd();
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={(e) => {
          if (headDrag.current === e.pointerId) {
            headDrag.current = null;
            props.onScrubEnd();
          }
        }}
        onLostPointerCapture={(e) => {
          if (headDrag.current === e.pointerId) {
            headDrag.current = null;
            props.onScrubEnd();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            props.onSeek(
              Math.max(
                0,
                Math.min(
                  project.duration,
                  playhead + (e.key === 'ArrowLeft' ? -1 : 1) / project.fps,
                ),
              ),
            );
          }
        }}
      />
      {trimHint ? (
        <output className={styles.trimHint}>{trimHint}</output>
      ) : null}
      <footer className={styles.footer}>
        <button
          type="button"
          aria-label="assets"
          aria-expanded={open}
          onClick={() => {
            setLocalOpen(!open);
            props.onAssetsOpenChange?.(!open);
          }}
        >
          <FolderOpen size={16} />
          assets
        </button>
        <span>
          {timecode(playhead)} / {timecode(project.duration)}
        </span>
        <span>{props.editState.saveStatus}</span>
        <button
          type="button"
          onClick={() => props.onZoomChange?.(null)}
          disabled={!props.onZoomChange}
        >
          fit
        </button>
        <input
          type="range"
          aria-label="timeline zoom"
          min={4}
          max={600}
          value={zoom}
          disabled={!props.onZoomChange}
          onChange={(e) => props.onZoomChange?.(Number(e.currentTarget.value))}
        />
      </footer>
      {menu && menuClip ? (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label={`clip actions for ${clipLabel(menuClip, assets)}`}
          className={styles.menu}
          style={{ left: menu.x, top: menu.y }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setMenu(undefined);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            const items = [
              ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button:not(:disabled)',
              ),
            ];
            const current = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              items[
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? items.length - 1
                    : (current +
                        (e.key === 'ArrowDown' ? 1 : -1) +
                        items.length) %
                      items.length
              ]?.focus();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              closeMenu();
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={menuLocked}
            onClick={() => {
              attempt(
                () => splitClips(project, [menuClip.id], playhead),
                'split clip',
              );
              closeMenu();
            }}
          >
            split at playhead
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={menuLocked}
            onClick={() => {
              attempt(
                () => duplicateClips(project, [menuClip.id]),
                'duplicate clip',
              );
              closeMenu();
            }}
          >
            duplicate
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={menuLocked}
            onClick={() => {
              attempt(
                () =>
                  deleteClips(
                    project,
                    selection.includes(menuClip.id) ? selection : [menuClip.id],
                  ),
                'delete clips',
              );
              closeMenu();
            }}
          >
            delete
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={menuLocked}
            onClick={() => {
              props.onInspect(menuClip.id, 'speed');
              closeMenu();
            }}
          >
            speed…
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={menuLocked || menuClip.kind !== 'video'}
            onClick={() => {
              attempt(() => detachAudio(project, menuClip.id), 'detach audio');
              closeMenu();
            }}
          >
            detach audio
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={menuLocked || !props.onReplace}
            onClick={() => {
              props.onReplace?.(menuClip.id);
              closeMenu();
            }}
          >
            replace media…
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!props.onMessage}
            onClick={() => {
              props.onMessage?.(`@${clipLabel(menuClip, assets)} `);
              closeMenu();
            }}
          >
            ask kimo about this clip
          </button>
          <div role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              group(
                [
                  {
                    op: 'clip.update',
                    id: menuClip.id,
                    patch: { locked: !menuClip.locked },
                  },
                ],
                'lock clip',
              );
              closeMenu();
            }}
          >
            lock
          </button>
        </div>
      ) : null}
    </div>
  );
}
