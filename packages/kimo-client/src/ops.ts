import type { KimoProject, Op } from './schema';
export function applyOps(
  project: KimoProject,
  ops: readonly Op[],
  version = project.version + 1,
): KimoProject {
  const next: KimoProject = structuredClone(project);
  for (const op of ops) {
    switch (op.op) {
      case 'clip.add':
        next.clips[op.clip.id] = structuredClone(op.clip);
        break;
      case 'clip.update': {
        const clip = next.clips[op.id];
        if (clip) Object.assign(clip, structuredClone(op.patch));
        break;
      }
      case 'clip.remove':
        Reflect.deleteProperty(next.clips, op.id);
        break;
      case 'clip.move': {
        const c = next.clips[op.id];
        if (c) {
          c.trackId = op.trackId;
          c.start = op.start;
        }
        break;
      }
      case 'clip.trim': {
        const c = next.clips[op.id];
        if (c) {
          if (op.edge === 'in') {
            const delta = (op.value - c.in) / c.speed;
            c.in = op.value;
            c.start += delta;
            c.duration = Math.max(0, c.duration - delta);
          } else c.duration = Math.max(0, (op.value - c.in) / c.speed);
        }
        break;
      }
      case 'clip.split': {
        const c = next.clips[op.id];
        if (c && op.at > c.start && op.at < c.start + c.duration) {
          const offset = op.at - c.start;
          next.clips[op.newId] = {
            ...structuredClone(c),
            id: op.newId,
            start: op.at,
            animationOffsetSec: (c.animationOffsetSec ?? 0) + offset,
            in: c.in + offset * c.speed,
            duration: c.duration - offset,
          };
          c.duration = offset;
        }
        break;
      }
      case 'track.add':
        next.tracks.push(structuredClone(op.track));
        break;
      case 'track.update': {
        const t = next.tracks.find((t) => t.id === op.id);
        if (t) Object.assign(t, structuredClone(op.patch));
        break;
      }
      case 'text.update': {
        const c = next.clips[op.clipId];
        if (c?.text) c.text.content = op.content;
        break;
      }
      case 'effect.set': {
        const c = next.clips[op.clipId];
        if (c) {
          c.effects = c.effects.filter((e) => e.id !== op.effect.id);
          c.effects.push(structuredClone(op.effect));
        }
        break;
      }
      case 'keyframe.set': {
        const c = next.clips[op.clipId];
        if (c) {
          c.keyframes = c.keyframes.filter(
            (k) =>
              !(
                k.property === op.keyframe.property &&
                k.time === op.keyframe.time
              ),
          );
          c.keyframes.push(structuredClone(op.keyframe));
        }
        break;
      }
      case 'marker.add':
        next.markers.push(structuredClone(op.marker));
        break;
    }
  }
  next.version = version;
  next.duration = Math.max(
    0,
    ...Object.values(next.clips).map((c) => c.start + c.duration),
  );
  return next;
}
