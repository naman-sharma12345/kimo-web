import { applyOps, opSchema, type KimoProject, type Op } from '@kimo/client';

type Path = readonly string[];
interface Change {
  path: Path;
  before: unknown;
  after: unknown;
}
export interface HistoryRecord {
  id: string;
  label: string;
  author: 'user' | 'agent';
  actionId?: string;
  changes: Change[];
  available: boolean;
  strict?: { project: KimoProject; assetsIdentity: string };
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const arrayKey = (item: unknown): string | undefined =>
  record(item)
    ? typeof item.id === 'string'
      ? item.id
      : typeof item.property === 'string' && typeof item.time === 'number'
        ? `${item.property}@${item.time}`
        : undefined
    : undefined;
function read(root: unknown, path: Path): unknown {
  let value = root;
  for (const key of path) {
    if (Array.isArray(value))
      value = key.startsWith('$index:')
        ? value[Number(key.slice(7))]
        : key === '$order'
          ? value.map((item: unknown) => arrayKey(item))
          : value.find((item: unknown) => arrayKey(item) === key);
    else if (record(value)) value = value[key];
    else return undefined;
  }
  return value;
}
function write(root: unknown, path: Path, value: unknown): void {
  const parent = read(root, path.slice(0, -1));
  const key = path[path.length - 1];
  if (key === undefined) return;
  if (Array.isArray(parent)) {
    if (key.startsWith('$index:')) {
      parent[Number(key.slice(7))] = structuredClone(value);
      return;
    }
    if (key === '$order' && Array.isArray(value)) {
      const ordered = value
        .map((id: unknown) =>
          parent.find((item: unknown) => arrayKey(item) === id),
        )
        .filter((item: unknown) => item !== undefined);
      let cursor = 0;
      for (let i = 0; i < parent.length; i++)
        if (value.includes(arrayKey(parent[i]))) parent[i] = ordered[cursor++];
      return;
    }
    const index = parent.findIndex((item: unknown) => arrayKey(item) === key);
    if (value === undefined) {
      if (index >= 0) parent.splice(index, 1);
    } else if (index < 0) parent.push(structuredClone(value));
    else parent[index] = structuredClone(value);
  } else if (record(parent)) {
    if (value === undefined) Reflect.deleteProperty(parent, key);
    else parent[key] = structuredClone(value);
  }
}
function diff(
  before: unknown,
  after: unknown,
  path: Path,
  changes: Change[],
): void {
  if (same(before, after)) return;
  if (record(before) && record(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
      diff(before[key], after[key], [...path, key], changes);
    return;
  }
  if (
    Array.isArray(before) &&
    Array.isArray(after) &&
    before.length === after.length &&
    [...before, ...after].every(
      (item: unknown) =>
        record(item) &&
        typeof item.w === 'string' &&
        typeof item.t === 'number' &&
        typeof item.d === 'number',
    )
  ) {
    for (let index = 0; index < before.length; index++)
      diff(before[index], after[index], [...path, `$index:${index}`], changes);
    return;
  }
  if (
    Array.isArray(before) &&
    Array.isArray(after) &&
    [...before, ...after].every((item: unknown) => arrayKey(item) !== undefined)
  ) {
    const a = before.map((item: unknown) => arrayKey(item));
    const b = after.map((item: unknown) => arrayKey(item));
    for (const key of new Set([...a, ...b]))
      if (key)
        diff(read(before, [key]), read(after, [key]), [...path, key], changes);
    if (
      // mergeFieldIntent receives a field array at root, without its owning name.
      (path.length === 0 ||
        ['effects', 'keyframes'].includes(path[path.length - 1] ?? '')) &&
      !same(a, b)
    )
      changes.push({ path: [...path, '$order'], before: a, after: b });
    return;
  }
  changes.push({
    path,
    before: structuredClone(before),
    after: structuredClone(after),
  });
}
export function captureHistory(
  before: KimoProject,
  ops: readonly Op[],
  meta: Omit<HistoryRecord, 'changes' | 'available'>,
): HistoryRecord {
  const after = applyOps(before, ops, before.version);
  const changes: Change[] = [];
  diff(before.clips, after.clips, ['clips'], changes);
  diff(
    Object.fromEntries(before.tracks.map((track) => [track.id, track])),
    Object.fromEntries(after.tracks.map((track) => [track.id, track])),
    ['tracks'],
    changes,
  );
  for (const field of ['width', 'height', 'background', 'notes'] as const)
    diff(before[field], after[field], [field], changes);
  // Marker removal and arbitrary track insertion order are not wire operations.
  const available =
    same(before.markers, after.markers) &&
    before.tracks.every(
      (track, index) =>
        after.tracks.some((item) => item.id === track.id) ||
        index === before.tracks.length - 1,
    );
  return { ...meta, changes, available };
}
/** Conditional field inverses refuse same-field conflicts, preserving unrelated agent/user changes. */
export function historyOps(
  current: KimoProject,
  entry: HistoryRecord,
  direction: 'undo' | 'redo',
): Op[] {
  if (!entry.available)
    throw new Error(
      'Preimages or inverse operations are unavailable for this step',
    );
  const next = structuredClone(current);
  for (const change of entry.changes) {
    const expected = direction === 'undo' ? change.after : change.before;
    const actual = read(current, change.path);
    const orderMatches =
      change.path[change.path.length - 1] === '$order' &&
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      same(
        actual.filter((id: unknown) => expected.includes(id)),
        expected,
      );
    if (!same(actual, expected) && !orderMatches)
      throw new Error(
        'This field changed since the step; resolve the conflict before reverting',
      );
    write(
      next,
      change.path,
      direction === 'undo' ? change.before : change.after,
    );
  }
  const ops: Op[] = [];
  for (const track of next.tracks)
    if (!current.tracks.some((item) => item.id === track.id))
      ops.push({ op: 'track.add', track });
  for (const id of new Set([
    ...Object.keys(current.clips),
    ...Object.keys(next.clips),
  ])) {
    const before = current.clips[id];
    const after = next.clips[id];
    if (!before && after) ops.push({ op: 'clip.add', clip: after });
    else if (before && !after) ops.push({ op: 'clip.remove', id });
    else if (before && after && !same(before, after)) {
      // Existing wire defaults restore optional toggles without removing a locked clip.
      if (
        !entry.strict &&
        before.locked !== undefined &&
        after.locked === undefined
      )
        after.locked = false;
      if (
        !entry.strict &&
        before.volume !== undefined &&
        after.volume === undefined
      )
        after.volume = 1;
      if (
        !entry.strict &&
        before.keepPitch !== undefined &&
        after.keepPitch === undefined
      )
        after.keepPitch = false;
      if (
        !entry.strict &&
        before.duckUnderVoice !== undefined &&
        after.duckUnderVoice === undefined
      )
        after.duckUnderVoice = after.audioRole === 'music';
      if (
        !entry.strict &&
        before.fadeInSec !== undefined &&
        after.fadeInSec === undefined
      )
        after.fadeInSec = 0;
      if (
        !entry.strict &&
        before.fadeOutSec !== undefined &&
        after.fadeOutSec === undefined
      )
        after.fadeOutSec = 0;
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(after) as (keyof typeof after)[])
        if (key !== 'id' && !same(before[key], after[key]))
          patch[key] = after[key];
      // Removing optional fields has no unset wire patch. A current-state replacement
      // preserves every unrelated field; the conditional preimage above remains leaf-level.
      const absent = Object.keys(before).some((key) => !(key in after));
      if (absent)
        ops.push({ op: 'clip.remove', id }, { op: 'clip.add', clip: after });
      else ops.push(opSchema.parse({ op: 'clip.update', id, patch }));
    }
  }
  for (const track of next.tracks) {
    const previous = current.tracks.find((t) => t.id === track.id);
    if (previous && !same(previous, track)) {
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(track) as (keyof typeof track)[])
        if (key !== 'id' && !same(previous[key], track[key]))
          patch[key] = track[key];
      if (previous.solo !== undefined && track.solo === undefined)
        patch.solo = false;
      ops.push(opSchema.parse({ op: 'track.update', id: track.id, patch }));
    }
  }
  for (const track of current.tracks)
    if (!next.tracks.some((item) => item.id === track.id))
      ops.push({ op: 'track.remove', id: track.id });
  const projectPatch: Record<string, unknown> = {};
  for (const key of ['width', 'height', 'background', 'notes'] as const)
    if (!same(current[key], next[key])) {
      if (next[key] === undefined) {
        if (key === 'notes') projectPatch[key] = '';
        else if (key === 'background') projectPatch[key] = [0, 0, 0, 1];
      } else projectPatch[key] = next[key];
    }
  if ('width' in projectPatch || 'height' in projectPatch) {
    projectPatch.width = next.width;
    projectPatch.height = next.height;
  }
  if (Object.keys(projectPatch).length)
    ops.push(opSchema.parse({ op: 'project.update', patch: projectPatch }));
  return ops;
}

/** Same action may stream several batches; collapse repeated leaf writes to the original preimage. */
export function mergeHistoryRecord(
  target: HistoryRecord,
  incoming: HistoryRecord,
): void {
  target.available &&= incoming.available;
  for (const change of incoming.changes) {
    const previous = target.changes.find((item) =>
      same(item.path, change.path),
    );
    if (previous) {
      if (!same(previous.after, change.before)) target.available = false;
      previous.after = change.after;
    } else {
      if (
        target.changes.some(
          (item) =>
            item.path.every((part, index) => change.path[index] === part) ||
            change.path.every((part, index) => item.path[index] === part),
        )
      )
        target.available = false;
      target.changes.push(change);
    }
  }
  target.changes = target.changes.filter(
    (change) => !same(change.before, change.after),
  );
}

/** Field-level user intent can rebase onto fresh authority without overwriting untouched leaves. */
export function mergeFieldIntent(
  before: unknown,
  after: unknown,
  current: unknown,
): unknown {
  if (same(before, after)) return structuredClone(current);
  if (current === undefined || before === undefined)
    return structuredClone(after);
  if (record(before) && record(after) && record(current)) {
    const next = structuredClone(current);
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      if (same(before[key], after[key])) continue;
      if (after[key] === undefined) Reflect.deleteProperty(next, key);
      else next[key] = mergeFieldIntent(before[key], after[key], current[key]);
    }
    return next;
  }
  const words = (items: unknown[]): boolean =>
    items.every(
      (item: unknown) =>
        record(item) &&
        typeof item.w === 'string' &&
        typeof item.t === 'number' &&
        typeof item.d === 'number',
    );
  if (
    Array.isArray(before) &&
    Array.isArray(after) &&
    Array.isArray(current) &&
    words(before) &&
    words(after) &&
    words(current) &&
    (before.length !== current.length || before.length !== after.length)
  )
    return structuredClone(after);
  const changes: Change[] = [];
  diff(before, after, [], changes);
  const root: Record<string, unknown> = { value: structuredClone(current) };
  for (const change of changes)
    write(root, ['value', ...change.path], change.after);
  return root.value;
}
