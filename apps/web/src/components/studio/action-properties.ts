import type { KimoProject, Op } from '@kimo/client';
import type { PropertyActivity } from './inspector';
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function changed(
  before: unknown,
  after: unknown,
  path: string,
  out: string[],
): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (object(after)) {
    for (const [key, value] of Object.entries(after)) {
      if (key === 'id' || key === 'kind') continue;
      changed(
        object(before) ? before[key] : undefined,
        value,
        key === 'params' ? path : path ? `${path}.${key}` : key,
        out,
      );
    }
  } else if (path === 'effects' && Array.isArray(after)) {
    for (const effect of after)
      if (object(effect) && typeof effect.id === 'string')
        changed(
          Array.isArray(before)
            ? before.find((item) => object(item) && item.id === effect.id)
            : undefined,
          effect,
          `effects.${effect.id}`,
          out,
        );
  } else if (path) out.push(path);
}
/** Only called with an actual running actionId; op contents never establish authorship. */
export function actionProperties(
  project: KimoProject,
  ops: readonly Op[],
  actionId: string,
): PropertyActivity[] {
  const result: PropertyActivity[] = [];
  for (const op of ops) {
    let clipId: string | undefined;
    const paths: string[] = [];
    if (op.op === 'clip.update') {
      clipId = op.id;
      changed(project.clips[clipId], op.patch, '', paths);
    } else if (op.op === 'effect.set') {
      clipId = op.clipId;
      changed(
        project.clips[clipId]?.effects.find(
          (effect) => effect.id === op.effect.id,
        ),
        op.effect,
        `effects.${op.effect.id}`,
        paths,
      );
    } else if (op.op === 'text.update') {
      clipId = op.clipId;
      changed(
        project.clips[clipId]?.text?.content,
        op.content,
        'text.content',
        paths,
      );
      if (op.secondaryContent !== undefined)
        changed(
          project.clips[clipId]?.text?.secondaryContent,
          op.secondaryContent,
          'text.secondaryContent',
          paths,
        );
    } else if (op.op === 'keyframe.set') {
      clipId = op.clipId;
      paths.push(op.keyframe.property);
    }
    if (clipId)
      for (const property of paths)
        if (
          !result.some(
            (item) => item.clipId === clipId && item.property === property,
          )
        )
          result.push({ clipId, property, actionId, running: true });
  }
  return result;
}
