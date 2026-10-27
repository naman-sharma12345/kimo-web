import type { TimelineBeat } from './types';
import type { Asset, Clip, Track } from '@kimo/client';
import { clipLabel } from '@/lib/editing/display';
import { sourceClock } from './geometry';
import type { TimelineMediaCache } from './media-cache';
import type { ClipVisual } from './animation';
import { hoverTint } from './color';
export interface TrackPalette {
  panel: string;
  beat: string;
  text: string;
  label: string;
  wave: string;
  selected: string;
  orange: string;
  wash: string;
  highlight: string;
  hatch: string;
  video: string;
  broll: string;
  image: string;
  music: string;
  voice: string;
  sfx: string;
  textTint: string;
  fx: string;
  font: string;
  mono: string;
  textFont: string;
  radius: number;
}
export function readPalette(element: HTMLElement): TrackPalette {
  const css = window.getComputedStyle(element);
  const get = (name: string) => css.getPropertyValue(name).trim();
  const font = `${get('--weight-12')} ${get('--t-11')} ${get('--font-sans')}`;
  return {
    panel: get('--ink-1'),
    beat: get('--cream-16'),
    text: get('--cream-100'),
    label: get('--cream-60'),
    wave: get('--cream-38'),
    selected: get('--cream-100'),
    orange: get('--orange'),
    wash: get('--orange-12'),
    highlight: get('--timeline-highlight'),
    hatch: get('--timeline-hatch'),
    video: get('--track-video'),
    broll: get('--track-broll'),
    image: get('--track-image'),
    music: get('--track-music'),
    voice: get('--track-voice'),
    sfx: get('--track-sfx'),
    textTint: get('--track-text'),
    fx: get('--track-fx'),
    font,
    mono: `${get('--weight-12')} ${get('--t-11')} ${get('--font-mono')}`,
    textFont: `${get('--weight-12')} ${get('--t-12')} ${get('--font-sans')}`,
    radius: parseFloat(get('--r-6')) || 6,
  };
}
function tint(c: Clip, track: Track, p: TrackPalette) {
  return c.kind === 'text'
    ? p.textTint
    : c.kind === 'image'
      ? p.image
      : c.kind === 'audio'
        ? c.audioRole === 'music'
          ? p.music
          : c.audioRole === 'voice'
            ? p.voice
            : p.sfx
        : track.kind === 'overlay'
          ? p.broll
          : c.kind === 'video'
            ? p.video
            : p.fx;
}
export function drawTrack(
  ctx: CanvasRenderingContext2D,
  options: {
    clips: readonly Clip[];
    beats?: readonly TimelineBeat[];
    track: Track;
    assets: readonly Asset[];
    width: number;
    height: number;
    origin: number;
    zoom: number;
    palette: TrackPalette;
    selection: readonly string[];
    hover?: string;
    active?: string | null;
    activeOpacity?: number;
    domLabels?: ReadonlySet<string>;
    editingTextId?: string;
    media?: TimelineMediaCache;
    visuals?: readonly ClipVisual[];
  },
) {
  const { clips, track, width, height, origin, zoom, palette: p } = options;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = p.panel;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = p.hatch;
  ctx.lineWidth = 1;
  for (let x = -height; x < width; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(x + height, 0);
    ctx.stroke();
  }
  const overrides = new Map(options.visuals?.map((v) => [v.clip.id, v]));
  const rendered = [
    ...clips,
    ...(options.visuals ?? [])
      .filter((v) => !clips.some((c) => c.id === v.clip.id))
      .map((v) => v.clip),
  ];
  for (const c of rendered) {
    const visual = overrides.get(c.id);
    const x = (visual?.start ?? c.start) * zoom - origin;
    const w = (visual?.duration ?? c.duration) * zoom;
    ctx.save();
    ctx.globalAlpha = visual?.opacity ?? 1;
    ctx.beginPath();
    ctx.roundRect(x, 4, w, height - 8, p.radius);
    ctx.clip();
    ctx.fillStyle =
      options.hover === c.id ? hoverTint(tint(c, track, p)) : tint(c, track, p);
    ctx.fillRect(x, 4, w, height - 8);
    ctx.fillStyle = p.highlight;
    ctx.fillRect(x, 4, w, 1);
    const mediaWidth = Math.max(80, Math.min(1280, w));
    const media = options.media?.read(c, mediaWidth);
    if (media?.frames?.length) {
      const frames = media.frames;
      const tile = 80;
      ctx.globalAlpha = 0.6 * (visual?.opacity ?? 1);
      const start = Math.max(0, Math.floor(-x / tile));
      for (let i = start; i * tile < w && x + i * tile < width; i++) {
        const time = sourceClock(c, c.start + ((i + 0.5) * tile) / zoom);
        const nearest = frames.reduce((a, b) =>
          Math.abs(a.time - time) <= Math.abs(b.time - time) ? a : b,
        );
        if (nearest.image.complete && nearest.image.naturalWidth)
          ctx.drawImage(nearest.image, x + i * tile, 22, tile, height - 30);
      }
      ctx.globalAlpha = visual?.opacity ?? 1;
    }
    if (media?.waveform?.length) {
      const peaks = media.waveform;
      ctx.strokeStyle = p.wave;
      ctx.beginPath();
      // Existing compositor returns samples already windowed by source in/speed/duration.
      const left = Math.max(0, -x);
      const right = Math.min(w, width - x);
      for (let pixel = Math.floor(left); pixel < right; pixel += 2) {
        const amp = Math.min(
          1,
          Math.abs(
            peaks[
              Math.min(peaks.length - 1, Math.floor((pixel / w) * peaks.length))
            ] ?? 0,
          ),
        );
        const half = (amp * (height - 30)) / 2;
        ctx.moveTo(x + pixel, height / 2 - half + 6);
        ctx.lineTo(x + pixel, height / 2 + half + 6);
      }
      ctx.stroke();
    }
    if (!options.domLabels?.has(c.id)) {
      ctx.font = p.font;
      ctx.fillStyle = p.label;
      ctx.textBaseline = 'top';
      ctx.fillText(
        clipLabel(c, options.assets),
        Math.max(x + 8, 0),
        6,
        Math.max(0.1, w - 16),
      );
      if (c.speed !== 1) {
        ctx.font = p.mono;
        ctx.fillText(`${c.speed}×`, Math.max(x + w - 48, x + 8), 6);
      }
    }
    if (c.text && options.editingTextId !== c.id) {
      ctx.font = p.textFont;
      ctx.fillStyle = p.text;
      ctx.fillText(
        c.text.content,
        Math.max(x + 8, 0),
        24,
        Math.max(0.1, w - 16),
      );
    }
    if (options.active === c.id) {
      ctx.globalAlpha *= options.activeOpacity ?? 1;
      ctx.fillStyle = p.wash;
      ctx.fillRect(x, 4, w, height - 8);
    }
    ctx.restore();
    if (options.selection.includes(c.id) || options.active === c.id) {
      ctx.save();
      if (options.active === c.id) ctx.globalAlpha = options.activeOpacity ?? 1;
      ctx.strokeStyle = options.active === c.id ? p.orange : p.selected;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(
        x + 0.75,
        4.75,
        Math.max(0, w - 1.5),
        height - 9.5,
        p.radius,
      );
      ctx.stroke();
      ctx.restore();
    }
  }
  // One pass over actual supplied ticks on this bounded canvas, not a new animation loop.
  const seen = new Set<number>();
  ctx.save();
  ctx.strokeStyle = p.beat;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let hasBeats = false;
  for (const beat of options.beats ?? []) {
    const clip = clips.find((item) => item.id === beat.clipId);
    const x = beat.time * zoom - origin;
    if (
      !clip ||
      clip.audioRole !== 'music' ||
      clip.trackId !== track.id ||
      beat.trackId !== track.id ||
      !Number.isFinite(beat.time) ||
      beat.time < clip.start ||
      beat.time >= clip.start + clip.duration ||
      x < 0 ||
      x >= width ||
      seen.has(beat.time)
    )
      continue;
    seen.add(beat.time);
    hasBeats = true;
    ctx.moveTo(x, 22);
    ctx.lineTo(x, height - 8);
  }
  if (hasBeats) ctx.stroke();
  ctx.restore();
}
