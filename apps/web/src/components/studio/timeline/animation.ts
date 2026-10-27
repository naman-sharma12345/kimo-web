import type { Clip, Op } from '@kimo/client';
import { durations, spring } from '@/lib/motion';
export interface ClipVisual {
  clip: Clip;
  start: number;
  duration: number;
  opacity: number;
}
interface Motion {
  clip: Clip;
  start: number;
  width: number;
  velocity: number;
  startVelocity: number;
  targetStart: number;
  targetWidth: number;
  deletedAt?: number;
  startedAt?: number;
}
/** Actual incoming op metadata only. Deleted objects are render tombstones, never entities. */
export class AgentClipMotion {
  deleteDuration = durations.d3 * 1000;
  private moving = new Map<string, Motion>();
  apply(
    before: readonly Clip[],
    after: readonly Clip[],
    ops: readonly Op[],
    now: number,
  ) {
    const previous = new Map(before.map((clip) => [clip.id, clip]));
    const current = new Map(after.map((clip) => [clip.id, clip]));
    for (const op of ops) {
      const id =
        op.op === 'clip.add'
          ? op.clip.id
          : 'id' in op && op.op.startsWith('clip.')
            ? op.id
            : undefined;
      if (!id) continue;
      const old = previous.get(id);
      const clip = current.get(id);
      const prior = this.moving.get(id);
      if (op.op === 'clip.remove' && old)
        this.moving.set(id, {
          clip: old,
          start: prior?.start ?? old.start,
          width: prior?.width ?? old.duration,
          velocity: 0,
          startVelocity: 0,
          targetStart: old.start,
          targetWidth: 0,
          deletedAt: now,
        });
      else if (clip && (op.op === 'clip.add' || old))
        this.moving.set(id, {
          clip,
          start: prior?.start ?? old?.start ?? clip.start,
          width: prior?.width ?? old?.duration ?? 0,
          velocity: prior?.velocity ?? 0,
          startVelocity: prior?.startVelocity ?? 0,
          targetStart: clip.start,
          targetWidth: clip.duration,
          startedAt: now,
        });
    }
  }
  frame(now: number, deltaMs: number, reduced: boolean): ClipVisual[] {
    const output: ClipVisual[] = [];
    const dt = Math.min(32, Math.max(0, deltaMs)) / 1000;
    for (const [id, motion] of this.moving) {
      if (motion.deletedAt !== undefined) {
        const progress = Math.min(
          1,
          Math.max(
            0,
            (now - motion.deletedAt) /
              (reduced ? durations.d2 * 1000 : this.deleteDuration),
          ),
        );
        if (progress >= 1) {
          this.moving.delete(id);
          continue;
        }
        output.push({
          clip: motion.clip,
          start: motion.start,
          duration: reduced
            ? motion.clip.duration
            : motion.clip.duration * (1 - progress),
          opacity: 1 - progress,
        });
      } else {
        // spring.snappy, exact Phase 0 stiffness/damping/mass; bounded substeps.
        if (!reduced)
          for (let step = 0; step < 4; step++) {
            const sub = dt / 4;
            motion.startVelocity +=
              ((spring.snappy.stiffness * (motion.targetStart - motion.start) -
                spring.snappy.damping * motion.startVelocity) /
                spring.snappy.mass) *
              sub;
            motion.velocity +=
              ((spring.snappy.stiffness * (motion.targetWidth - motion.width) -
                spring.snappy.damping * motion.velocity) /
                spring.snappy.mass) *
              sub;
            motion.start += motion.startVelocity * sub;
            motion.width += motion.velocity * sub;
          }
        else {
          motion.start = motion.targetStart;
          motion.width = motion.targetWidth;
        }
        output.push({
          clip: motion.clip,
          start: motion.start,
          duration: Math.max(0, motion.width),
          opacity: reduced
            ? Math.min(
                1,
                Math.max(
                  0,
                  (now - (motion.startedAt ?? now)) / (durations.d2 * 1000),
                ),
              )
            : 1,
        });
        if (
          (reduced && now - (motion.startedAt ?? now) >= durations.d2 * 1000) ||
          (!reduced &&
            Math.abs(motion.start - motion.targetStart) +
              Math.abs(motion.width - motion.targetWidth) +
              Math.abs(motion.velocity) +
              Math.abs(motion.startVelocity) <
              0.0001)
        )
          this.moving.delete(id);
      }
    }
    return output;
  }
  get active() {
    return this.moving.size > 0;
  }
  clear() {
    this.moving.clear();
  }
}
