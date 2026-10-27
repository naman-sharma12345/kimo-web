import {
  applyOps,
  clipSchema,
  opSchema,
  type Asset,
  type Clip,
  type KimoProject,
  type Op,
  type Track,
} from '@kimo/client';
import { mainVideoTrack } from './display';
const EPS = 1e-7;
const finite = (n: number) => {
  if (!Number.isFinite(n)) throw new Error('A finite value is required');
  return n;
};
const frame = (p: KimoProject, n: number) =>
  Math.round(finite(n) * p.fps) / p.fps;
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, finite(n)));
const freshId: () => string = () => crypto.randomUUID();
export function opClipIds(op: Op): string[] {
  if (op.op === 'clip.add') return [op.clip.id];
  if ('clipId' in op) return [op.clipId];
  if (op.op.startsWith('clip.') && 'id' in op) return [op.id];
  return [];
}
function editable(p: KimoProject, id: string): Clip {
  const c = p.clips[id];
  if (!c) throw new Error(`Clip ${id} is unavailable`);
  const track = p.tracks.find((t) => t.id === c.trackId);
  if (!track) throw new Error('Track is unavailable');
  if (c.locked || track.locked) throw new Error('This clip is locked');
  return c;
}
export function trackAccepts(track: Track, clip: Clip): boolean {
  return track.kind === 'audio'
    ? clip.kind === 'audio'
    : track.kind === 'text'
      ? clip.kind === 'text'
      : track.kind === 'video'
        ? clip.kind === 'video' || clip.kind === 'image'
        : ['video', 'image', 'shape', 'adjustment'].includes(clip.kind);
}
function validateClip(p: KimoProject, c: Clip, assets: readonly Asset[]) {
  clipSchema.parse(c);
  const track = p.tracks.find((t) => t.id === c.trackId);
  if (!track || !trackAccepts(track, c))
    throw new Error('Clip and track kinds must match');
  if (c.duration + EPS < 1 / p.fps)
    throw new Error('A clip must last at least one frame');
  if (c.kind === 'text' && !c.text) throw new Error('Text content is required');
  if (c.kind !== 'text' && c.text)
    throw new Error('Text fields require a text clip');
  if (
    !['video', 'audio'].includes(c.kind) &&
    [
      c.keepPitch,
      c.fadeInSec,
      c.fadeOutSec,
      c.duckUnderVoice,
      c.audioRole,
    ].some((field) => field !== undefined)
  )
    throw new Error('Audio fields require an audio or video clip');
  const crop = c.transform.crop;
  if (crop && (crop.l + crop.r >= 1 || crop.t + crop.b >= 1))
    throw new Error('Crop must leave visible content');
  if (new Set(c.effects.map((effect) => effect.id)).size !== c.effects.length)
    throw new Error('Effect IDs must be unique within a clip');
  const asset = assets.find((a) => a.id === c.assetId);
  if (assets.length && c.assetId && !asset)
    throw new Error('Source asset is unavailable');
  if (
    assets.length &&
    c.mask &&
    !assets.some((a) => a.id === c.mask?.maskAssetId)
  )
    throw new Error('Mask asset is unavailable');
  if (
    asset &&
    (c.kind === 'audio'
      ? !['audio', 'video'].includes(asset.kind)
      : ['video', 'image'].includes(c.kind) && c.kind !== asset.kind)
  )
    throw new Error('Source asset kind does not match the clip');
  if (
    asset?.durationSec !== undefined &&
    ['video', 'audio'].includes(c.kind) &&
    c.in + c.duration * c.speed > asset.durationSec + EPS
  )
    throw new Error('Edit exceeds source duration');
  if ((c.fadeInSec ?? 0) > c.duration || (c.fadeOutSec ?? 0) > c.duration)
    throw new Error('Fade exceeds clip duration');
  if (c.volume !== undefined && c.volume > 10 ** (12 / 20) + EPS)
    throw new Error('Volume exceeds +12 dB');
}
/** Shared commit boundary for gesture, keyboard and numeric paths. Returns parsed payloads. */
export function validateCommands(
  project: KimoProject,
  input: readonly Op[],
  assets: readonly Asset[] = [],
): Op[] {
  const ops = input.map((op) => opSchema.parse(op));
  let p = project;
  const touched = new Set<string>();
  const touchedTracks = new Set<string>();
  for (const op of ops) {
    if (op.op === 'clip.add' && p.clips[op.clip.id])
      throw new Error('Clip ID already exists');
    if (op.op === 'track.add' && p.tracks.some((t) => t.id === op.track.id))
      throw new Error('Track ID already exists');
    for (const id of opClipIds(op)) {
      if (op.op === 'clip.add') continue;
      const c = p.clips[id];
      const unlockOnly =
        op.op === 'clip.update' &&
        Object.keys(op.patch).every((key) => key === 'locked');
      if (!c) throw new Error('Clip is unavailable');
      if (!unlockOnly) editable(p, id);
      if (op.op === 'text.update' && c.kind !== 'text')
        throw new Error('Select a text clip');
    }
    if (
      op.op === 'clip.move' ||
      (op.op === 'clip.update' && op.patch.trackId !== undefined)
    ) {
      const old = p.tracks.find((t) => t.id === p.clips[op.id]?.trackId);
      const targetId = op.op === 'clip.move' ? op.trackId : op.patch.trackId;
      const target = p.tracks.find((t) => t.id === targetId);
      if (!target || target.locked || old?.kind !== target.kind)
        throw new Error('Move requires an unlocked track of the same kind');
    }
    if (
      op.op === 'clip.add' &&
      p.tracks.find((t) => t.id === op.clip.trackId)?.locked
    )
      throw new Error('Track is locked');
    if (op.op === 'clip.split') {
      const c = p.clips[op.id];
      if (
        !c ||
        op.at - c.start + EPS < 1 / p.fps ||
        c.start + c.duration - op.at + EPS < 1 / p.fps ||
        p.clips[op.newId]
      )
        throw new Error(
          'Split must leave a frame on each side and use a fresh ID',
        );
    }
    if (op.op === 'track.remove') {
      const track = p.tracks.find((item) => item.id === op.id);
      if (
        !track ||
        track.locked ||
        Object.values(p.clips).some((clip) => clip.trackId === op.id)
      )
        throw new Error('Only unlocked empty tracks can be removed');
    }
    if (op.op === 'track.update') {
      const t = p.tracks.find((t) => t.id === op.id);
      if (
        !t ||
        (t.locked && Object.keys(op.patch).some((key) => key !== 'locked'))
      )
        throw new Error('Track is unavailable or locked');
    }
    p = applyOps(p, [op], project.version);
    for (const id of opClipIds(op)) touched.add(id);
    if (op.op === 'clip.split') touched.add(op.newId);
    if (op.op === 'track.update') touchedTracks.add(op.id);
  }
  for (const clip of Object.values(p.clips))
    if (touched.has(clip.id) || touchedTracks.has(clip.trackId))
      validateClip(p, clip, assets);
  return ops;
}
export function moveClips(
  p: KimoProject,
  ids: readonly string[],
  delta: number,
  trackId?: string,
): Op[] {
  const clips = ids.map((id) => editable(p, id));
  const d = Math.max(frame(p, delta), -Math.min(...clips.map((c) => c.start)));
  return validateCommands(
    p,
    clips.map((c) => ({
      op: 'clip.move',
      id: c.id,
      trackId: trackId ?? c.trackId,
      start: c.start + d,
    })),
  );
}
export function trimClip(
  p: KimoProject,
  id: string,
  edge: 'in' | 'out',
  sourceValue: number,
  options: { ripple?: boolean; assets?: readonly Asset[] } = {},
): Op[] {
  const c = editable(p, id);
  const end = c.in + c.duration * c.speed;
  const max =
    options.assets?.find((a) => a.id === c.assetId)?.durationSec ?? Infinity;
  const value =
    edge === 'in'
      ? clamp(
          sourceValue,
          options.ripple ? 0 : Math.max(0, c.in - c.start * c.speed),
          end - c.speed / p.fps,
        )
      : clamp(sourceValue, c.in + c.speed / p.fps, max);
  const duration =
    edge === 'in' ? (end - value) / c.speed : (value - c.in) / c.speed;
  const ops: Op[] =
    options.ripple && edge === 'in'
      ? [{ op: 'clip.update', id, patch: { in: value, duration } }]
      : [{ op: 'clip.trim', id, edge, value }];
  if (c.fadeInSec !== undefined || c.fadeOutSec !== undefined)
    ops.push({
      op: 'clip.update',
      id,
      patch: {
        ...(c.fadeInSec === undefined
          ? {}
          : { fadeInSec: Math.min(c.fadeInSec, duration) }),
        ...(c.fadeOutSec === undefined
          ? {}
          : { fadeOutSec: Math.min(c.fadeOutSec, duration) }),
      },
    });
  if (options.ripple) {
    for (const later of Object.values(p.clips))
      if (
        later.trackId === c.trackId &&
        later.id !== id &&
        later.start >= c.start + c.duration - EPS
      )
        ops.push({
          op: 'clip.move',
          id: later.id,
          trackId: later.trackId,
          start: later.start + duration - c.duration,
        });
  }
  return validateCommands(p, ops, options.assets);
}
export function deleteClips(
  p: KimoProject,
  ids: readonly string[],
  options: { lift?: boolean } = {},
): Op[] {
  const selected = new Set(ids);
  const clips = [...selected].map((id) => editable(p, id));
  const main = mainVideoTrack(p)?.id;
  const intervals = clips
    .filter((c) => c.trackId === main)
    .map((c) => [c.start, c.start + c.duration] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const union: [number, number][] = [];
  for (const interval of intervals) {
    const last = union[union.length - 1];
    if (last && interval[0] <= last[1])
      last[1] = Math.max(last[1], interval[1]);
    else union.push([...interval]);
  }
  const ops: Op[] = clips.map((c) => ({ op: 'clip.remove', id: c.id }));
  if (!options.lift)
    for (const c of Object.values(p.clips))
      if (c.trackId === main && !selected.has(c.id)) {
        const removed = union.reduce(
          (sum, [a, b]) => sum + Math.max(0, Math.min(c.start, b) - a),
          0,
        );
        if (removed)
          ops.push({
            op: 'clip.move',
            id: c.id,
            trackId: c.trackId,
            start: c.start - removed,
          });
      }
  return validateCommands(p, ops);
}
export function splitClips(
  p: KimoProject,
  ids: readonly string[],
  at: number,
  makeId = freshId,
): Op[] {
  const selected = ids.length
    ? ids.map((id) => editable(p, id))
    : Object.values(p.clips).filter(
        (c) => !c.locked && !p.tracks.find((t) => t.id === c.trackId)?.locked,
      );
  const time = frame(p, at);
  return validateCommands(
    p,
    selected
      .filter(
        (c) =>
          time >= c.start + 1 / p.fps - EPS &&
          time <= c.start + c.duration - 1 / p.fps + EPS,
      )
      .map((c) => ({ op: 'clip.split', id: c.id, at: time, newId: makeId() })),
  );
}
export function duplicateClips(
  p: KimoProject,
  ids: readonly string[],
  makeId = freshId,
  delta?: number,
): Op[] {
  const clips = ids.map((id) => editable(p, id));
  if (!clips.length) return [];
  const d = Math.max(
    frame(
      p,
      delta ??
        Math.max(...clips.map((c) => c.start + c.duration)) -
          Math.min(...clips.map((c) => c.start)),
    ),
    -Math.min(...clips.map((c) => c.start)),
  );
  const groups = new Map<string, string>();
  return validateCommands(
    p,
    clips.map((c) => {
      const copy = structuredClone(c);
      copy.id = makeId();
      copy.start = Math.max(0, frame(p, c.start + d));
      const effects = new Map(
        copy.effects.map((effect) => [effect.id, makeId()]),
      );
      copy.effects = copy.effects.map((effect) => ({
        ...effect,
        id: effects.get(effect.id) ?? effect.id,
      }));
      copy.keyframes = copy.keyframes.map((key) => {
        const parts = key.property.split('.');
        const replacement =
          parts[0] === 'effects' && parts[1]
            ? effects.get(parts[1])
            : undefined;
        return replacement
          ? {
              ...key,
              property: `effects.${replacement}.${parts.slice(2).join('.')}`,
            }
          : key;
      });
      if (copy.linkGroupId) {
        if (!groups.has(copy.linkGroupId))
          groups.set(copy.linkGroupId, makeId());
        copy.linkGroupId = groups.get(copy.linkGroupId);
      }
      return { op: 'clip.add', clip: copy };
    }),
  );
}
export function slipClip(
  p: KimoProject,
  id: string,
  sourceIn: number,
  assets: readonly Asset[] = [],
): Op[] {
  const c = editable(p, id);
  const max = assets.find((a) => a.id === c.assetId)?.durationSec;
  return validateCommands(
    p,
    [
      {
        op: 'clip.update',
        id,
        patch: {
          in: clamp(
            sourceIn,
            0,
            max === undefined
              ? Infinity
              : Math.max(0, max - c.duration * c.speed),
          ),
        },
      },
    ],
    assets,
  );
}
/** Preserve source span; no implicit ripple. */
export function speedClip(
  p: KimoProject,
  id: string,
  speed: number,
  assets: readonly Asset[] = [],
): Op[] {
  const c = editable(p, id);
  if (finite(speed) <= 0) throw new Error('Speed must be positive');
  speed = Math.min(speed, c.duration * c.speed * p.fps);
  const duration = (c.duration * c.speed) / speed;
  return validateCommands(
    p,
    [
      {
        op: 'clip.update',
        id,
        patch: {
          speed,
          duration,
          ...(c.fadeInSec === undefined
            ? {}
            : { fadeInSec: Math.min(c.fadeInSec, duration) }),
          ...(c.fadeOutSec === undefined
            ? {}
            : { fadeOutSec: Math.min(c.fadeOutSec, duration) }),
        },
      },
    ],
    assets,
  );
}
export function detachAudio(
  p: KimoProject,
  id: string,
  makeId = freshId,
): Op[] {
  const c = editable(p, id);
  if (c.kind !== 'video' || !c.assetId)
    throw new Error('Select a video source');
  if (
    c.linkGroupId &&
    Object.values(p.clips).some(
      (clip) =>
        clip.id !== c.id &&
        clip.kind === 'audio' &&
        clip.linkGroupId === c.linkGroupId,
    )
  )
    throw new Error('Audio is already detached');
  const track = p.tracks.find((t) => t.kind === 'audio' && !t.locked);
  const trackId = track?.id ?? makeId();
  const group = c.linkGroupId ?? makeId();
  const audio: Clip = {
    id: makeId(),
    trackId,
    assetId: c.assetId,
    kind: 'audio',
    start: c.start,
    duration: c.duration,
    in: c.in,
    speed: c.speed,
    volume: c.volume ?? 1,
    linkGroupId: group,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    effects: [],
    keyframes: c.keyframes.filter((key) => key.property === 'volume'),
    ...(c.animationOffsetSec === undefined
      ? {}
      : { animationOffsetSec: c.animationOffsetSec }),
    ...(c.fadeInSec === undefined ? {} : { fadeInSec: c.fadeInSec }),
    ...(c.fadeOutSec === undefined ? {} : { fadeOutSec: c.fadeOutSec }),
    ...(c.duckUnderVoice === undefined
      ? {}
      : { duckUnderVoice: c.duckUnderVoice }),
    ...(c.audioRole === undefined ? {} : { audioRole: c.audioRole }),
    ...(c.keepPitch === undefined ? {} : { keepPitch: c.keepPitch }),
  };
  return validateCommands(p, [
    ...(track
      ? []
      : [
          {
            op: 'track.add' as const,
            track: {
              id: trackId,
              kind: 'audio' as const,
              name: 'audio',
              muted: false,
              hidden: false,
              locked: false,
              height: 64 as const,
            },
          },
        ]),
    {
      op: 'clip.update',
      id,
      patch: {
        volume: 0,
        linkGroupId: group,
        keyframes: c.keyframes.filter((key) => key.property !== 'volume'),
      },
    },
    { op: 'clip.add', clip: audio },
  ]);
}
export function setGlobalAudio(p: KimoProject, off: boolean): Op[] {
  return validateCommands(
    p,
    p.tracks
      .filter(
        (t) =>
          t.kind === 'audio' ||
          Object.values(p.clips).some(
            (c) => c.trackId === t.id && c.kind === 'video',
          ),
      )
      .map((t) => ({ op: 'track.update', id: t.id, patch: { muted: off } })),
  );
}
