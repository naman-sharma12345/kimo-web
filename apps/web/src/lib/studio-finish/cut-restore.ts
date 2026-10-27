import {
  applyOps,
  assetSchema,
  opSchema,
  projectSchema,
  type Asset,
  type KimoProject,
  type Op,
} from '@kimo/client';
import { validateCommands } from '../editing/commands';
import { captureHistory, historyOps } from '../editing/history';
import { editIdentity } from '../editing/persistence';
import type { EditGroupOptions, EditState } from '../editing/types';
import type { LocalCut } from './index';

export interface CutRestoreReason {
  code: string;
  message: string;
}
export type CutRestorePlan =
  | { available: false; reasons: CutRestoreReason[] }
  | { available: true; ops: Op[]; options: EditGroupOptions; noop: boolean };
export type CutRestoreCurrent = EditState & { sessionId: string };
const equal = (a: unknown, b: unknown) => editIdentity(a) === editIdentity(b);
const content = (p: KimoProject) => ({ ...p, version: 0 });
function fail(code: string, message: string): never {
  throw new RestoreError({ code, message });
}
class RestoreError extends Error {
  constructor(readonly reason: CutRestoreReason) {
    super(reason.message);
  }
}
function validateProject(project: KimoProject, assets: readonly Asset[]) {
  if (new Set(project.tracks.map((t) => t.id)).size !== project.tracks.length)
    fail('duplicate-track', 'Track IDs must be unique');
  if (new Set(project.markers.map((m) => m.id)).size !== project.markers.length)
    fail('duplicate-marker', 'Marker IDs must be unique');
  const ids = new Set(assets.map((a) => a.id));
  if (ids.size !== assets.length)
    fail('duplicate-asset', 'Asset IDs must be unique');
  for (const [id, clip] of Object.entries(project.clips)) {
    if (id !== clip.id)
      fail('clip-key', `Clip map key ${id} does not match clip.id`);
    if (['video', 'audio', 'image'].includes(clip.kind) && !clip.assetId)
      fail('source-missing', `Clip ${id} requires a source asset`);
    if (clip.assetId && !ids.has(clip.assetId))
      fail(
        'asset-missing',
        `Source asset ${clip.assetId} for clip ${id} is unavailable`,
      );
    const source = assets.find((a) => a.id === clip.assetId);
    if (source && !(source.proxyUrl || source.url).trim())
      fail(
        'asset-url-missing',
        `Source asset for clip ${id} has no usable registered URL`,
      );
    if (
      ['video', 'audio'].includes(clip.kind) &&
      source?.durationSec === undefined
    )
      fail(
        'source-bounds-unknown',
        `Source duration for clip ${id} is unknown`,
      );
    if (clip.mask && !assets.find((a) => a.id === clip.mask?.maskAssetId)?.mask)
      fail(
        'mask-missing',
        `Mask asset for clip ${id} is unavailable or lacks metadata`,
      );
    const mask = assets.find((a) => a.id === clip.mask?.maskAssetId);
    if (mask?.mask && mask.mask.encoding !== 'luma_image') {
      const origin = mask.mask.timeOrigin ?? 0;
      if (mask.durationSec === undefined)
        fail(
          'mask-bounds-unknown',
          `Animated mask duration for clip ${id} is unknown`,
        );
      if (
        clip.in < origin ||
        clip.in + clip.duration * clip.speed > origin + mask.durationSec + 1e-7
      )
        fail(
          'mask-source-bounds',
          `Clip ${id} exceeds animated mask source bounds`,
        );
    }
    for (const effect of clip.effects) {
      if (
        effect.kind === 'lut' ||
        typeof effect.params.lutAssetId === 'string'
      ) {
        const assetId = effect.params.assetId ?? effect.params.lutAssetId;
        if (
          typeof assetId !== 'string' ||
          !assets.find((a) => a.id === assetId)?.lut
        )
          fail(
            'lut-missing',
            `LUT asset for effect ${effect.id} is unavailable or lacks metadata`,
          );
      }
    }
  }
  // Validate every clip, not only the ones changed by the restore. Locks are
  // checked separately for mutations; they do not invalidate unchanged content.
  validateCommands(
    {
      ...project,
      clips: {},
      tracks: project.tracks.map((t) => ({ ...t, locked: false })),
    },
    Object.values(project.clips).map((clip) => ({ op: 'clip.add', clip })),
    assets,
  );
  const derived = Math.max(
    0,
    ...Object.values(project.clips).map((c) => c.start + c.duration),
  );
  if (project.duration !== derived)
    fail(
      'duration-unexpressible',
      'Stored duration is not the duration derived from the clips',
    );
}
function referencedAssets(project: KimoProject): Set<string> {
  const refs = new Set<string>();
  for (const clip of Object.values(project.clips)) {
    if (clip.assetId) refs.add(clip.assetId);
    if (clip.mask) refs.add(clip.mask.maskAssetId);
    for (const effect of clip.effects)
      if (
        effect.kind === 'lut' ||
        typeof effect.params.lutAssetId === 'string'
      ) {
        const id = effect.params.assetId ?? effect.params.lutAssetId;
        if (typeof id === 'string') refs.add(id);
      }
  }
  return refs;
}
/** Pure existing-wire preflight. No writes, networking, historical asset injection or normalization. */
export function planCutRestore(
  current: CutRestoreCurrent,
  cut: LocalCut,
  currentAssets: readonly Asset[],
): CutRestorePlan {
  try {
    if (current.sessionId !== cut.sessionId)
      fail('session-mismatch', 'Cut belongs to another session');
    if (current.acknowledged.id !== cut.project.id)
      fail('project-mismatch', 'Cut belongs to another project');
    if (current.online === false)
      fail('offline', 'Restore requires online dispatch');
    if (
      current.persistenceStatus !== 'ready' ||
      !current.storageAvailable ||
      !current.dispatchEnabled ||
      current.persistencePending ||
      current.saveStatus !== 'saved'
    )
      fail(
        'durability-not-ready',
        'Restore requires saved, ready durable editing storage and online authority',
      );
    if (current.draft || current.pending.length || current.suggestions.length)
      fail(
        'editing-busy',
        'Finish drafts, pending writes and suggestions before reviewing a restore',
      );
    if (
      current.acknowledgedVersion !== current.acknowledged.version ||
      !equal(current.project, current.acknowledged) ||
      !equal(current.assets, currentAssets)
    )
      fail(
        'authority-mismatch',
        'Restore must be reviewed against the acknowledged live project and assets',
      );
    const before = projectSchema.parse(current.acknowledged);
    const target = projectSchema.parse(cut.project);
    const assets = currentAssets.map((a) => assetSchema.parse(a));
    const historicalAssets = cut.assets.map((a) => assetSchema.parse(a));
    if (
      new Set(historicalAssets.map((a) => a.id)).size !==
        historicalAssets.length ||
      !equal(historicalAssets, cut.assets)
    )
      fail(
        'historical-assets-invalid',
        'Historical assets must be uniquely identified and use represented wire fields',
      );
    if (
      !equal(before, current.acknowledged) ||
      !equal(target, cut.project) ||
      !equal(assets, currentAssets)
    )
      fail(
        'unavailable-wire-fields',
        'Project or asset contains fields not represented by the current wire schema',
      );
    if (!equal(before.markers, target.markers))
      fail(
        'markers-unexpressible',
        'Marker changes have no faithful reversible existing operation',
      );
    if (
      !equal(
        before.tracks.map((t) => t.id),
        target.tracks.map((t) => t.id),
      )
    )
      fail(
        'track-order-unexpressible',
        'This subset requires unchanged track identity and order',
      );
    validateProject(before, assets);
    validateProject(target, assets);
    for (const id of referencedAssets(target)) {
      const historical = historicalAssets.find((a) => a.id === id);
      if (
        !historical ||
        !equal(
          historical,
          assets.find((a) => a.id === id),
        )
      )
        fail(
          'asset-identity-changed',
          `Historical asset ${id} is not identical to the currently registered asset`,
        );
    }
    const ops: Op[] = [];
    for (const track of target.tracks) {
      const previous = before.tracks.find((t) => t.id === track.id);
      if (!previous || equal(previous, track)) continue;
      if (previous.locked || track.locked)
        fail(
          'track-locked',
          `Track ${track.id} is locked or would become locked`,
        );
      if ((previous.solo === undefined) !== (track.solo === undefined))
        fail(
          'track-optional-presence',
          `Track ${track.id} solo absence cannot be restored exactly in both directions`,
        );
      const { id, ...patch } = track;
      ops.push(opSchema.parse({ op: 'track.update', id, patch }));
    }
    for (const id of new Set([
      ...Object.keys(before.clips),
      ...Object.keys(target.clips),
    ])) {
      const a = before.clips[id];
      const b = target.clips[id];
      if (equal(a, b)) continue;
      if (
        a?.locked ||
        b?.locked ||
        before.tracks.find((t) => t.id === a?.trackId)?.locked ||
        target.tracks.find((t) => t.id === b?.trackId)?.locked
      )
        fail(
          'clip-locked',
          `Clip ${id} is locked, on a locked track, or would introduce a lock`,
        );
      if (!b) ops.push({ op: 'clip.remove', id });
      else if (!a) ops.push({ op: 'clip.add', clip: b });
      else if (Object.keys(a).some((key) => !(key in b)))
        ops.push({ op: 'clip.remove', id }, { op: 'clip.add', clip: b });
      else {
        const { id: clipId, ...patch } = b;
        ops.push(opSchema.parse({ op: 'clip.update', id: clipId, patch }));
      }
    }
    const patch: Record<string, unknown> = {};
    for (const key of ['background', 'notes'] as const) {
      if ((before[key] === undefined) !== (target[key] === undefined))
        fail(
          'project-unset-unexpressible',
          `Project ${key} absence cannot be restored in both directions`,
        );
      if (!equal(before[key], target[key])) patch[key] = target[key];
    }
    if (before.width !== target.width || before.height !== target.height) {
      patch.width = target.width;
      patch.height = target.height;
    }
    if (Object.keys(patch).length)
      ops.push(opSchema.parse({ op: 'project.update', patch }));
    const parsed = validateCommands(before, ops, assets);
    const after = applyOps(before, parsed, before.version);
    if (!equal(content(after), content(target)))
      fail('forward-inexact', 'Existing operations do not reach the exact cut');
    const entry = captureHistory(before, parsed, {
      id: 'preflight',
      label: 'restore',
      author: 'user',
    });
    entry.strict = { project: after, assetsIdentity: editIdentity(assets) };
    const inverse = validateCommands(
      after,
      historyOps(after, entry, 'undo'),
      assets,
    );
    const undone = applyOps(after, inverse, before.version);
    if (!equal(content(undone), content(before)))
      fail('inverse-inexact', 'Undo cannot restore the exact current project');
    const compensation = captureHistory(after, inverse, {
      id: 'preflight-redo',
      label: 'redo',
      author: 'user',
    });
    compensation.strict = {
      project: undone,
      assetsIdentity: editIdentity(assets),
    };
    const redo = validateCommands(
      undone,
      historyOps(undone, compensation, 'undo'),
      assets,
    );
    if (
      !equal(content(applyOps(undone, redo, before.version)), content(target))
    )
      fail('redo-inexact', 'Redo cannot restore the exact cut');
    return {
      available: true,
      ops: parsed,
      noop: parsed.length === 0,
      options: {
        strictGuard: {
          sessionId: current.sessionId,
          projectId: before.id,
          version: before.version,
          projectIdentity: editIdentity(before),
          assetsIdentity: editIdentity(assets),
          opsIdentity: editIdentity(parsed),
        },
      },
    };
  } catch (cause) {
    return {
      available: false,
      reasons: [
        cause instanceof RestoreError
          ? cause.reason
          : {
              code: 'invalid-or-unsupported',
              message: cause instanceof Error ? cause.message : String(cause),
            },
      ],
    };
  }
}
