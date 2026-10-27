import type { Clip, KimoProject } from '@kimo/client';
import { resolveText } from './text-styles';
import type {
  ResolvedAudio,
  ResolvedLayer,
  ResolvedTransitionPair,
  SceneBuildOptions,
  SceneGraph,
} from './types';

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const active = (clip: Clip, t: number) =>
  clip.start <= t && t < clip.start + clip.duration;
export function sourceTime(clip: Clip, t: number): number {
  return clip.in + (t - clip.start) * clip.speed;
}
export function animationTime(clip: Clip, t: number): number {
  return t - clip.start + (clip.animationOffsetSec ?? 0);
}
/** The easing belongs to the departing key; duplicate times use the last input key. */
export function interpolateKeyframes(
  keys: readonly Clip['keyframes'][number][],
  t: number,
  base: number,
): number {
  if (!keys.length) return base;
  const sorted = [...new Map(keys.map((k) => [k.time, k])).values()].sort(
    (a, b) => a.time - b.time,
  );
  const first = sorted[0];
  if (!first) return base;
  if (t <= first.time) return first.value;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1],
      b = sorted[i];
    if (!a || !b || t >= b.time) continue;
    const u = clamp((t - a.time) / (b.time - a.time));
    let e = u;
    switch (a.easing) {
      case 'hold':
        e = 0;
        break;
      case 'ease_out':
        e = 1 - (1 - u) ** 3;
        break;
      case 'ease_in_out':
        e = u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
        break;
      case 'bezier': {
        const h = a.bezier;
        if (h) {
          const cubic = (v: number, p: number, q: number) =>
            3 * (1 - v) ** 2 * v * p + 3 * (1 - v) * v ** 2 * q + v ** 3;
          let lo = 0,
            hi = 1;
          for (let n = 0; n < 40; n++) {
            const v = (lo + hi) / 2;
            if (cubic(v, h[0], h[2]) < u) lo = v;
            else hi = v;
          }
          e = cubic((lo + hi) / 2, h[1], h[3]);
        }
        break;
      }
    }
    return a.value + (b.value - a.value) * e;
  }
  return sorted[sorted.length - 1]?.value ?? base;
}
function scalar(clip: Clip, property: string, t: number, base: number): number {
  return interpolateKeyframes(
    clip.keyframes.filter(
      (k) => k.property === property || k.property === `transform.${property}`,
    ),
    t,
    base,
  );
}
export function transitionDuration(
  transition: NonNullable<Clip['transitionIn']>,
  fps: number,
): number {
  return transition.durationFrames !== undefined
    ? transition.durationFrames / fps
    : (transition.duration ?? 0);
}
const knownEffects = new Set([
  'colour_grade',
  'grade',
  'blur',
  'gaussian_blur',
  'vignette',
  'grain',
  'film_grain',
  'sharpen',
  'black_white',
  'black_and_white',
  'bw',
  'zoom_punch',
  'zoom_punch_in',
  'lut',
]);
const transformProperties = new Set([
  'x',
  'y',
  'scale',
  'rotation',
  'opacity',
  'volume',
]);

/** Deterministic target ramps, including interrupted/overlapping voice intervals. */
export function duckGainAt(voices: readonly Clip[], t: number): number {
  const events = new Map<number, number>();
  for (const voice of voices) {
    if (voice.duration <= 0) continue;
    events.set(voice.start, (events.get(voice.start) ?? 0) + 1);
    const end = voice.start + voice.duration;
    events.set(end, (events.get(end) ?? 0) - 1);
  }
  let count = 0,
    rampStart = 0,
    from = 1,
    target = 1;
  const at = (time: number) =>
    from + (target - from) * clamp((time - rampStart) / 0.3);
  for (const [time, delta] of [...events].sort((a, b) => a[0] - b[0])) {
    if (time > t) break;
    const gain = at(time);
    count += delta;
    const next = count > 0 ? 10 ** (-12 / 20) : 1;
    if (next !== target) {
      from = gain;
      target = next;
      rampStart = time;
    }
  }
  return at(t);
}
function resolveLayer(
  clip: Clip,
  project: KimoProject,
  t: number,
  options: SceneBuildOptions,
  suppress: { in?: boolean; out?: boolean } = {},
  animationSpanSec = clip.duration + (clip.animationOffsetSec ?? 0),
): ResolvedLayer {
  const q = animationTime(clip, t);
  const transform = structuredClone(clip.transform);
  for (const property of ['x', 'y', 'scale', 'rotation', 'opacity'] as const)
    transform[property] = scalar(clip, property, q, transform[property]);
  transform.opacity = clamp(transform.opacity);
  transform.scale = Math.max(0, transform.scale);
  const layer: ResolvedLayer = {
    clipId: clip.id,
    trackId: clip.trackId,
    kind: clip.kind,
    assetId: clip.assetId,
    sourceTime: sourceTime(clip, t),
    localTime: t - clip.start,
    animationTime: q,
    transform,
    opacity: transform.opacity,
    crop: transform.crop,
    effects: [],
    transitions: [],
    approximations: [],
  };
  const warn = (reason: string) => {
    if (!layer.approximations.includes(reason))
      layer.approximations.push(reason);
  };
  for (const key of clip.keyframes) {
    const property = key.property.replace(/^transform\./, '');
    if (
      !transformProperties.has(property) &&
      !clip.effects.some((effect) =>
        Object.keys(effect.params).some(
          (param) => key.property === `effects.${effect.id}.${param}`,
        ),
      )
    )
      warn(`Unsupported keyframe property: ${key.property}`);
  }
  if (clip.assetId && !options.assets?.[clip.assetId])
    warn('Asset metadata unavailable');
  if ((clip.kind === 'video' || clip.kind === 'image') && !clip.assetId)
    warn('Missing media asset');
  if (
    transform.crop &&
    (transform.crop.l + transform.crop.r >= 1 ||
      transform.crop.t + transform.crop.b >= 1)
  )
    warn('Crop units or bounds require server agreement');
  if (clip.kind === 'adjustment') warn('Adjustment layer scope is unspecified');
  if (clip.kind === 'shape') {
    if (clip.shape) layer.shape = structuredClone(clip.shape);
    else warn('Shape geometry unavailable');
  }
  if (clip.kind === 'text') {
    if (clip.text)
      layer.text = resolveText(clip.text, q, project.width, project.height);
    else warn('Text payload unavailable');
  }
  if (clip.mask) {
    const metadata = options.assets?.[clip.mask.maskAssetId]?.mask;
    layer.mask = {
      assetId: clip.mask.maskAssetId,
      invert: clip.mask.invert,
      feather: clip.mask.feather,
      mode: clip.mask.mode ?? 'selection',
      sourceTime: layer.sourceTime,
      metadata: metadata ? structuredClone(metadata) : undefined,
    };
    if (!metadata) warn('Mask encoding metadata unavailable');
    else if (metadata.encoding !== 'luma_image') {
      layer.mask.frameIndex = Math.floor(
        (layer.sourceTime - (metadata.timeOrigin ?? 0)) * metadata.fps,
      );
      if (layer.mask.frameIndex < 0) warn('Mask time precedes encoded range');
    }
    if (clip.mask.feather > 0)
      warn('Legacy mask feather units require server agreement');
    if (!clip.mask.mode)
      warn(
        'Legacy mask intent defaults to selection; server agreement pending',
      );
  }
  for (const effect of clip.effects) {
    const params = { ...effect.params };
    for (const [param, value] of Object.entries(params))
      if (typeof value === 'number')
        params[param] = scalar(clip, `effects.${effect.id}.${param}`, q, value);
    const scope = effect.scope ?? 'all';
    layer.effects.push({ id: effect.id, kind: effect.kind, params, scope });
    if (!knownEffects.has(effect.kind))
      warn(`Unsupported effect: ${effect.kind}`);
    if (scope !== 'all' && !clip.mask)
      warn(`Scoped effect ${effect.id} has no mask`);
    if (effect.kind === 'lut' || typeof params.lutAssetId === 'string') {
      const assetId =
        typeof params.lutAssetId === 'string' ? params.lutAssetId : '';
      if (!options.assets?.[assetId]?.lut)
        warn('LUT atlas metadata unavailable');
    }
    if (effect.kind === 'zoom_punch' || effect.kind === 'zoom_punch_in') {
      const amount = typeof params.amount === 'number' ? params.amount : 0;
      const attack =
        typeof params.attack === 'number' ? Math.max(0, params.attack) : 0.3;
      const release =
        typeof params.release === 'number' ? Math.max(0, params.release) : 0.3;
      const envelope = Math.min(
        attack === 0 ? 1 : clamp(q / attack),
        release === 0 ? 1 : clamp((animationSpanSec - q) / release),
      );
      transform.scale *= Math.max(0, 1 + amount * envelope);
    }
  }
  for (const phase of ['in', 'out'] as const) {
    if (suppress[phase]) continue;
    const transition = phase === 'in' ? clip.transitionIn : clip.transitionOut;
    if (!transition || transition.kind === 'cut') continue;
    const durationSec = Math.min(
      transitionDuration(transition, project.fps),
      animationSpanSec,
    );
    if (durationSec <= 0) continue;
    // Evaluate copied transitions on the original animation clock after a split.
    const elapsed = phase === 'in' ? q : q - (animationSpanSec - durationSec);
    if (elapsed < 0 || elapsed >= durationSec) continue;
    const progress = clamp(elapsed / durationSec),
      direction = transition.direction ?? 'left';
    const visibility = phase === 'in' ? progress : 1 - progress;
    const blurPx =
      transition.kind === 'whip' ? 64 * 4 * progress * (1 - progress) : 0;
    layer.transitions.push({
      kind: transition.kind,
      phase,
      progress,
      durationSec,
      direction,
      blurPx,
    });
    if (
      transition.kind === 'crossfade' ||
      transition.kind === 'dip' ||
      transition.kind === 'zoom_in'
    )
      layer.opacity *= visibility;
    if (transition.kind === 'zoom_in')
      transform.scale *= 1 + 0.15 * (1 - visibility);
    if (transition.kind === 'slide' || transition.kind === 'whip') {
      const sign = direction === 'left' || direction === 'up' ? -1 : 1;
      const displacement = phase === 'in' ? -(1 - progress) : progress;
      if (direction === 'left' || direction === 'right')
        transform.x += sign * displacement * project.width;
      else transform.y += sign * displacement * project.height;
    }
    warn(
      'Clip-local transition preview; paired source handles and server blend unverified',
    );
  }
  return layer;
}
interface LogicalClip {
  clip: Clip;
  members: Clip[];
  animationSpanSec: number;
}
function sameTransition(
  a: Clip['transitionIn'],
  b: Clip['transitionIn'],
): boolean {
  if (!a || !b) return a === b;
  return (
    a.kind === b.kind &&
    (a.direction ?? 'left') === (b.direction ?? 'left') &&
    Math.abs(transitionDuration(a, 30) - transitionDuration(b, 30)) <= 1e-7
  );
}
/** Copied split fragments share both an animation origin and a continuous source map. */
function logicalClips(clips: readonly Clip[]): LogicalClip[] {
  const groups: LogicalClip[] = [];
  for (const clip of [...clips].sort(clipOrder)) {
    const group = [...groups].reverse().find((candidate) => {
      const last = candidate.members.at(-1);
      return (
        last &&
        clip.duration > 0 &&
        last.duration > 0 &&
        clip.animationOffsetSec !== undefined &&
        clip.animationOffsetSec > 0 &&
        clip.kind === last.kind &&
        clip.assetId === last.assetId &&
        clip.speed === last.speed &&
        Math.abs(last.start + last.duration - clip.start) <= 1e-7 &&
        Math.abs(
          (last.animationOffsetSec ?? 0) +
            last.duration -
            clip.animationOffsetSec,
        ) <= 1e-7 &&
        Math.abs(last.in + last.duration * last.speed - clip.in) <= 1e-7 &&
        sameTransition(last.transitionIn, clip.transitionIn) &&
        sameTransition(last.transitionOut, clip.transitionOut)
      );
    });
    if (group) {
      group.members.push(clip);
      group.clip = {
        ...group.clip,
        duration: clip.start + clip.duration - group.clip.start,
      };
      group.animationSpanSec =
        group.clip.duration + (group.clip.animationOffsetSec ?? 0);
    } else
      groups.push({
        clip: { ...clip },
        members: [clip],
        animationSpanSec: clip.duration + (clip.animationOffsetSec ?? 0),
      });
  }
  return groups;
}
function logicalMember(group: LogicalClip, t: number): Clip {
  return (
    group.members.find((clip) => active(clip, t)) ??
    (t < group.clip.start ? group.members[0] : group.members.at(-1)) ??
    group.clip
  );
}
interface PairPlan {
  outgoing: Clip;
  incoming: Clip;
  pair: ResolvedTransitionPair;
  warnings: string[];
}
const clipOrder = (a: Clip, b: Clip) =>
  a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Pair same-track butt cuts. No clip durations/start/in values are rewritten. */
function planTransitionPairs(clips: readonly Clip[], fps: number): PairPlan[] {
  const ordered = clips
    .filter(
      (c) => c.kind !== 'audio' && c.kind !== 'adjustment' && c.duration > 0,
    )
    .slice()
    .sort(clipOrder);
  const usedOutgoing = new Set<string>();
  const plans: PairPlan[] = [];
  for (const incoming of ordered) {
    const outgoing = ordered
      .filter(
        (c) =>
          c.id !== incoming.id &&
          c.start < incoming.start &&
          Math.abs(c.start + c.duration - incoming.start) <= 1e-7 &&
          !usedOutgoing.has(c.id),
      )
      .at(-1);
    if (!outgoing) continue;
    const transition = incoming.transitionIn ?? outgoing.transitionOut;
    if (!transition || transition.kind === 'cut') continue;
    const requested = transitionDuration(transition, fps);
    const durationSec = Math.min(
      requested,
      outgoing.duration,
      incoming.duration,
    );
    if (durationSec <= 0) continue;
    const boundary = incoming.start;
    const warnings: string[] = [];
    if (requested > durationSec)
      warnings.push('Transition duration bounded by adjacent clip spans');
    if (
      incoming.transitionIn &&
      outgoing.transitionOut &&
      (incoming.transitionIn.kind !== outgoing.transitionOut.kind ||
        Math.abs(
          transitionDuration(incoming.transitionIn, fps) -
            transitionDuration(outgoing.transitionOut, fps),
        ) > 1e-7 ||
        (incoming.transitionIn.direction ?? 'left') !==
          (outgoing.transitionOut.direction ?? 'left'))
    )
      warnings.push(
        'Conflicting transition pair declarations; incoming transitionIn wins',
      );
    plans.push({
      outgoing,
      incoming,
      warnings,
      pair: {
        id: `transition:${JSON.stringify([outgoing.id, incoming.id])}`,
        trackId: incoming.trackId,
        outgoingClipId: outgoing.id,
        incomingClipId: incoming.id,
        compositeAtClipId: incoming.id,
        kind: transition.kind,
        boundary,
        start: boundary - durationSec / 2,
        end: boundary + durationSec / 2,
        durationSec,
        progress: 0,
        direction: transition.direction ?? 'left',
        composite:
          transition.kind === 'slide' || transition.kind === 'whip'
            ? 'source_over'
            : 'premultiplied_mix',
        outgoingWeight: 1,
        incomingWeight: 0,
        blackWeight: 0,
      },
    });
    usedOutgoing.add(outgoing.id);
  }
  return plans;
}
function pairAt(plan: PairPlan, t: number): ResolvedTransitionPair {
  const pair = { ...plan.pair };
  const u = clamp((t - pair.start) / pair.durationSec);
  pair.progress = u;
  if (pair.composite === 'source_over') {
    pair.outgoingWeight = 1;
    pair.incomingWeight = 1;
  } else if (pair.kind === 'dip') {
    pair.outgoingWeight = Math.max(0, 1 - 2 * u);
    pair.incomingWeight = Math.max(0, 2 * u - 1);
    pair.blackWeight = 1 - pair.outgoingWeight - pair.incomingWeight;
  } else {
    pair.outgoingWeight = 1 - u;
    pair.incomingWeight = u;
  }
  return pair;
}
function resolvePairMember(
  clip: Clip,
  role: 'outgoing' | 'incoming',
  pair: ResolvedTransitionPair,
  project: KimoProject,
  t: number,
  options: SceneBuildOptions,
  suppress: { in?: boolean; out?: boolean },
  bounds = clip,
  animationSpanSec = clip.duration + (clip.animationOffsetSec ?? 0),
): ResolvedLayer {
  const requested = sourceTime(clip, t);
  let sample = clip.kind === 'video' ? requested : Math.max(0, requested);
  const asset = clip.assetId ? options.assets?.[clip.assetId] : undefined;
  const fps =
    (clip.assetId ? options.sourceFps?.[clip.assetId] : undefined) ??
    project.fps;
  const warnings: string[] = [];
  let boundary: 'start' | 'end' | undefined;
  if (clip.kind === 'video') {
    const beforeStart = t < bounds.start;
    const afterEnd = t >= bounds.start + bounds.duration;
    if (requested < 0) boundary = 'start';
    else if (asset?.durationSec !== undefined && requested >= asset.durationSec)
      boundary = role === 'outgoing' ? 'end' : 'start';
    else if (afterEnd && asset?.durationSec === undefined) boundary = 'end';
    if (boundary) {
      sample =
        boundary === 'start'
          ? bounds.in
          : Math.max(
              bounds.in,
              (Math.ceil(
                (bounds.in + bounds.duration * bounds.speed) * fps - 1e-9,
              ) -
                1) /
                fps,
            );
      if (asset?.durationSec !== undefined)
        sample = clamp(
          sample,
          0,
          Math.max(0, (Math.ceil(asset.durationSec * fps - 1e-9) - 1) / fps),
        );
      sample = Math.max(0, sample);
      warnings.push(
        beforeStart
          ? 'Incoming transition preroll unavailable; frozen first boundary frame'
          : afterEnd
            ? 'Outgoing transition postroll unavailable; frozen last boundary frame'
            : 'Transition source outside asset range; frozen valid boundary frame',
      );
    }
  }
  const sampleTimelineTime = boundary
    ? clip.start + (sample - clip.in) / clip.speed
    : t;
  const layer = resolveLayer(
    clip,
    project,
    sampleTimelineTime,
    options,
    suppress,
    animationSpanSec,
  );
  layer.sourceTime = sample;
  if (layer.mask) {
    layer.mask.sourceTime = sample;
    const metadata = layer.mask.metadata;
    if (metadata && metadata.encoding !== 'luma_image')
      layer.mask.frameIndex = Math.floor(
        (sample - (metadata.timeOrigin ?? 0)) * metadata.fps,
      );
  }
  layer.transitionPairId = pair.id;
  layer.transitionRole = role;
  layer.transitionSample = {
    mode: boundary ? 'boundary' : 'handle',
    requestedSourceTime: requested,
    sampleTimelineTime,
    boundary,
  };
  layer.approximations.push(...warnings);
  const u = pair.progress,
    phase = role === 'outgoing' ? 'out' : 'in';
  const blurPx = pair.kind === 'whip' ? 64 * 4 * u * (1 - u) : 0;
  layer.transitions.push({
    kind: pair.kind,
    phase,
    progress: u,
    durationSec: pair.durationSec,
    direction: pair.direction,
    blurPx,
  });
  if (pair.kind === 'zoom_in' && role === 'incoming')
    layer.transform.scale *= 1 + 0.15 * (1 - u);
  if (pair.kind === 'slide' || pair.kind === 'whip') {
    const sign = pair.direction === 'left' || pair.direction === 'up' ? -1 : 1;
    const displacement = role === 'outgoing' ? sign * u : -sign * (1 - u);
    if (pair.direction === 'left' || pair.direction === 'right')
      layer.transform.x += displacement * project.width;
    else layer.transform.y += displacement * project.height;
  }
  return layer;
}
export function buildScene(
  project: KimoProject,
  t: number,
  options: SceneBuildOptions = {},
): SceneGraph {
  if (!Number.isFinite(t)) throw new RangeError('Scene time must be finite');
  for (const fps of Object.values(options.sourceFps ?? {}))
    if (!Number.isFinite(fps) || fps <= 0)
      throw new RangeError('Source fps must be finite and positive');
  const master = options.masterVolume ?? 1;
  if (!Number.isFinite(master) || master < 0)
    throw new RangeError('Master volume must be finite and nonnegative');
  const scene: SceneGraph = {
    time: t,
    frame: Math.floor(t * project.fps),
    width: project.width,
    height: project.height,
    fps: project.fps,
    layers: [],
    transitionPairs: [],
    audio: [],
    approximations: [],
  };
  const clips = Object.values(project.clips);
  const tracks = new Map(project.tracks.map((track) => [track.id, track]));
  const hasSolo = project.tracks.some((track) => track.solo);
  const audible = (clip: Clip) => {
    const track = tracks.get(clip.trackId);
    return !!track && !track.muted && (!hasSolo || !!track.solo);
  };
  const voices = clips.filter(
    (clip) =>
      (clip.kind === 'audio' || clip.kind === 'video') &&
      clip.audioRole === 'voice' &&
      audible(clip),
  );
  const duck = duckGainAt(voices, t);
  for (const track of project.tracks) {
    const trackClips = clips.filter((clip) => clip.trackId === track.id);
    const groups = logicalClips(trackClips);
    const groupByRoot = new Map(groups.map((group) => [group.clip.id, group]));
    const groupByMember = new Map(
      groups.flatMap((group) =>
        group.members.map((member) => [member.id, group] as const),
      ),
    );
    const plans = track.hidden
      ? []
      : planTransitionPairs(
          groups.map((group) => group.clip),
          project.fps,
        );
    const suppress = new Map<string, { in?: boolean; out?: boolean }>();
    for (const plan of plans) {
      for (const member of groupByRoot.get(plan.outgoing.id)?.members ?? [
        plan.outgoing,
      ])
        suppress.set(member.id, { ...suppress.get(member.id), out: true });
      for (const member of groupByRoot.get(plan.incoming.id)?.members ?? [
        plan.incoming,
      ])
        suppress.set(member.id, { ...suppress.get(member.id), in: true });
    }
    const activePlans = plans.filter(
      (plan) => plan.pair.start <= t && t < plan.pair.end,
    );
    const members = new Map<
      string,
      {
        plan: PairPlan;
        pair: ResolvedTransitionPair;
        role: 'outgoing' | 'incoming';
      }
    >();
    for (const plan of activePlans) {
      const pair = pairAt(plan, t);
      const outgoingGroup = groupByRoot.get(plan.outgoing.id);
      const incomingGroup = groupByRoot.get(plan.incoming.id);
      const outgoing = outgoingGroup
        ? logicalMember(outgoingGroup, t)
        : plan.outgoing;
      const incoming = incomingGroup
        ? logicalMember(incomingGroup, t)
        : plan.incoming;
      pair.outgoingClipId = outgoing.id;
      pair.incomingClipId = incoming.id;
      pair.compositeAtClipId = incoming.id;
      scene.transitionPairs?.push(pair);
      members.set(outgoing.id, { plan, pair, role: 'outgoing' });
      members.set(incoming.id, { plan, pair, role: 'incoming' });
    }
    const ordered = trackClips
      .filter((clip) => active(clip, t) || members.has(clip.id))
      .sort(clipOrder);
    for (const clip of ordered) {
      if (active(clip, t) && (clip.kind === 'video' || clip.kind === 'audio')) {
        const role = clip.audioRole ?? 'other';
        const muted = !audible(clip);
        const duckGain = role === 'music' ? duck : 1;
        const audio: ResolvedAudio = {
          clipId: clip.id,
          trackId: track.id,
          assetId: clip.assetId,
          sourceTime: sourceTime(clip, t),
          playbackRate: clip.speed,
          role,
          muted,
          duckGain,
          gain:
            Math.max(
              0,
              scalar(clip, 'volume', animationTime(clip, t), clip.volume ?? 1),
            ) *
            master *
            duckGain *
            (muted ? 0 : 1),
        };
        scene.audio.push(audio);
      }
      if (track.hidden || clip.kind === 'audio') continue;
      const member = members.get(clip.id);
      const layer = member
        ? resolvePairMember(
            clip,
            member.role,
            member.pair,
            project,
            t,
            options,
            suppress.get(clip.id) ?? {},
            member.role === 'outgoing'
              ? member.plan.outgoing
              : member.plan.incoming,
            groupByMember.get(clip.id)?.animationSpanSec,
          )
        : resolveLayer(
            clip,
            project,
            t,
            options,
            suppress.get(clip.id),
            groupByMember.get(clip.id)?.animationSpanSec,
          );
      if (member) layer.approximations.push(...member.plan.warnings);
      scene.layers.push(layer);
      scene.approximations.push(
        ...layer.approximations.map((reason) => ({ clipId: clip.id, reason })),
      );
    }
  }
  for (const clip of clips)
    if (active(clip, t) && !tracks.has(clip.trackId))
      scene.approximations.push({
        clipId: clip.id,
        reason: 'Clip track unavailable',
      });
  return scene;
}
export class PureSceneBuilder {
  static build = buildScene;
  build = buildScene;
}
export const SceneBuilder = PureSceneBuilder;
