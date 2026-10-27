import { applyOps, opSchema, type KimoProject, type Op } from '@kimo/client';
import { mergeFieldIntent } from './history';
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
/** Preserve the operation names and explicit user changes, merging unrelated authoritative leaves. */
export function rebaseCommands(
  baseline: KimoProject,
  current: KimoProject,
  ops: readonly Op[],
): Op[] {
  let before = baseline;
  let latest = current;
  const result: Op[] = [];
  for (const op of ops) {
    let rebased: Op | undefined = op;
    if (op.op === 'clip.update') {
      const original = before.clips[op.id];
      const now = latest.clips[op.id];
      if (original && now) {
        const patch: Record<string, unknown> = {};
        for (const key of Object.keys(op.patch) as (keyof typeof op.patch)[]) {
          if (!same(original[key], op.patch[key]))
            patch[key] = mergeFieldIntent(
              original[key],
              op.patch[key],
              now[key],
            );
        }
        rebased = Object.keys(patch).length
          ? opSchema.parse({ op: 'clip.update', id: op.id, patch })
          : undefined;
      }
    } else if (op.op === 'text.update') {
      const original = before.clips[op.clipId]?.text;
      const now = latest.clips[op.clipId]?.text;
      if (original && now) {
        const changed =
          !same(original.content, op.content) ||
          (op.words !== undefined && !same(original.words, op.words)) ||
          (op.secondaryContent !== undefined &&
            !same(original.secondaryContent, op.secondaryContent));
        rebased = changed
          ? opSchema.parse({
              ...op,
              content: same(original.content, op.content)
                ? now.content
                : op.content,
              ...(op.words === undefined
                ? {}
                : {
                    words: mergeFieldIntent(
                      original.words,
                      op.words,
                      now.words,
                    ),
                  }),
              ...(op.secondaryContent === undefined
                ? {}
                : {
                    secondaryContent: same(
                      original.secondaryContent,
                      op.secondaryContent,
                    )
                      ? now.secondaryContent
                      : op.secondaryContent,
                  }),
            })
          : undefined;
      }
    } else if (op.op === 'clip.move') {
      const original = before.clips[op.id];
      const now = latest.clips[op.id];
      if (original && now)
        rebased =
          op.start === original.start && op.trackId === original.trackId
            ? undefined
            : {
                ...op,
                start: op.start === original.start ? now.start : op.start,
                trackId:
                  op.trackId === original.trackId ? now.trackId : op.trackId,
              };
    } else if (op.op === 'effect.set') {
      const original = before.clips[op.clipId]?.effects.find(
        (effect) => effect.id === op.effect.id,
      );
      const now = latest.clips[op.clipId]?.effects.find(
        (effect) => effect.id === op.effect.id,
      );
      if (original && now)
        rebased = opSchema.parse({
          ...op,
          effect: mergeFieldIntent(original, op.effect, now),
        });
    }
    before = applyOps(before, [op], before.version);
    if (rebased) {
      result.push(rebased);
      latest = applyOps(latest, [rebased], latest.version);
    }
  }
  return result;
}
