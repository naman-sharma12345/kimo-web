import { describe, expect, it } from 'vitest';
import { applyOps, type KimoProject } from '@kimo/client';
import { assets, fixture } from '../editing/test-fixtures';
import { captureHistory, historyOps } from '../editing/history';
import { editIdentity } from '../editing/persistence';
import type { EditState } from '../editing/types';
import type { LocalCut } from './index';
import { planCutRestore } from './cut-restore';

export function restoreState(
  project: KimoProject = fixture(),
): EditState & { sessionId: string } {
  return {
    sessionId: 's',
    persistenceStatus: 'ready',
    persistencePending: false,
    editingEnabled: true,
    dispatchEnabled: true,
    project,
    acknowledged: project,
    acknowledgedVersion: project.version,
    assets,
    pending: [],
    draft: null,
    saveStatus: 'saved',
    storageAvailable: true,
    canUndo: false,
    canRedo: false,
    history: [],
    suggestions: [],
  };
}
export function restoreCut(project: KimoProject): LocalCut {
  return {
    id: 'cut',
    sessionId: 's',
    requestId: 'r',
    label: 'cut 1',
    ordinal: 1,
    createdAt: 0,
    project,
    assets,
  };
}
function reason(project: KimoProject, target: KimoProject, code: string) {
  expect(
    planCutRestore(restoreState(project), restoreCut(target), assets),
  ).toMatchObject({
    available: false,
    reasons: [expect.objectContaining({ code })],
  });
}
describe('faithful existing-op cut restore', () => {
  it('plans exact forward, inverse and redo for nested edits, source timing, adds and optional absence', () => {
    const before = fixture();
    before.clips.c.volume = 0.5;
    before.clips.c.transform.crop = { l: 0.1, r: 0, t: 0, b: 0 };
    const target = fixture();
    target.width = 1080;
    target.height = 1920;
    target.clips.c.in = 2;
    target.clips.t.text = {
      content: 'changed',
      style: 'caption-clean',
      words: [{ w: 'changed', t: 0, d: 4 }],
    };
    target.clips.extra = {
      ...structuredClone(target.clips.c),
      id: 'extra',
      start: 1,
      duration: 3,
    };
    const frozen = editIdentity(target);
    const plan = planCutRestore(
      restoreState(before),
      restoreCut(target),
      assets,
    );
    expect(plan.available).toBe(true);
    if (!plan.available) return;
    const after = applyOps(before, plan.ops, 0);
    expect(editIdentity(after)).toBe(editIdentity(target));
    const history = captureHistory(before, plan.ops, {
      id: 'h',
      label: 'restore',
      author: 'user',
    });
    history.strict = { project: after, assetsIdentity: editIdentity(assets) };
    expect(
      editIdentity(applyOps(after, historyOps(after, history, 'undo'), 0)),
    ).toBe(editIdentity(before));
    expect(editIdentity(target)).toBe(frozen);
  });
  it('uses no operations for identical content, regardless of historical version', () => {
    const target = fixture();
    target.version = 99;
    expect(
      planCutRestore(restoreState(), restoreCut(target), assets),
    ).toMatchObject({ available: true, noop: true, ops: [] });
  });
  it('supports exact clip deletion and supported track/project fields', () => {
    const target = fixture();
    Reflect.deleteProperty(target.clips, 'c');
    const before = fixture();
    before.notes = 'old';
    target.notes = 'new';
    const firstTrack = target.tracks[0];
    if (!firstTrack) throw new Error('Missing fixture track');
    firstTrack.muted = true;
    expect(
      planCutRestore(restoreState(before), restoreCut(target), assets)
        .available,
    ).toBe(true);
  });
  it('restores registered static masks, LUTs, effect/keyframe order and nested optional removal', () => {
    const catalog = [
      ...assets,
      {
        id: 'mask',
        kind: 'image' as const,
        name: 'mask',
        url: '/mask.png',
        source: 'user' as const,
        mask: {
          encoding: 'luma_image' as const,
          width: 64,
          height: 64,
          coordinateSpace: 'source_uv' as const,
          channel: 'luma' as const,
        },
      },
      {
        id: 'lut',
        kind: 'image' as const,
        name: 'lut',
        url: '/lut.png',
        source: 'user' as const,
        lut: {
          size: 64 as const,
          layout: 'tiles_8x8' as const,
          colorSpace: 'srgb' as const,
        },
      },
    ];
    const before = fixture();
    before.clips.c.effects = [
      { id: 'grade', kind: 'grade', params: { exposure: 1 } },
      { id: 'lut', kind: 'lut', params: { lutAssetId: 'lut' } },
    ];
    before.clips.c.keyframes = [
      { property: 'transform.x', time: 0, value: 1 },
      { property: 'transform.x', time: 2, value: 2 },
    ];
    before.clips.c.transform.crop = { l: 0.1, r: 0, t: 0, b: 0 };
    const target = structuredClone(before);
    target.clips.c.effects.reverse();
    target.clips.c.keyframes.reverse();
    delete target.clips.c.transform.crop;
    target.clips.c.mask = {
      kind: 'sam',
      maskAssetId: 'mask',
      invert: false,
      feather: 0,
    };
    const result = planCutRestore(
      { ...restoreState(before), assets: catalog },
      { ...restoreCut(target), assets: catalog },
      catalog,
    );
    expect(result.available).toBe(true);
    if (result.available)
      expect(editIdentity(applyOps(before, result.ops, 0))).toBe(
        editIdentity(target),
      );
  });
  it('rejects unknown animated-mask bounds and offline review', () => {
    const state = { ...restoreState(), online: false };
    expect(planCutRestore(state, restoreCut(fixture()), assets)).toMatchObject({
      available: false,
      reasons: [{ code: 'offline', message: expect.any(String) }],
    });
    const target = fixture();
    target.clips.c.mask = {
      kind: 'sam',
      maskAssetId: 'm',
      invert: false,
      feather: 0,
    };
    const catalog = [
      ...assets,
      {
        id: 'm',
        kind: 'video' as const,
        name: 'mask',
        url: '/m.mp4',
        source: 'user' as const,
        mask: {
          encoding: 'video' as const,
          width: 64,
          height: 64,
          fps: 30,
          coordinateSpace: 'source_uv' as const,
          channel: 'luma' as const,
        },
      },
    ];
    expect(
      planCutRestore(
        { ...restoreState(), assets: catalog },
        { ...restoreCut(target), assets: catalog },
        catalog,
      ),
    ).toMatchObject({
      available: false,
      reasons: [{ code: 'mask-bounds-unknown', message: expect.any(String) }],
    });
  });
  it('rejects markers, track order, project unsets, and non-derived duration', () => {
    let target = fixture();
    target.markers = [{ id: 'm', time: 1, label: 'm' }];
    reason(fixture(), target, 'markers-unexpressible');
    target = fixture();
    target.tracks.reverse();
    reason(fixture(), target, 'track-order-unexpressible');
    const before = fixture();
    before.notes = 'present';
    reason(before, fixture(), 'project-unset-unexpressible');
    target = fixture();
    target.duration = 6;
    reason(fixture(), target, 'duration-unexpressible');
  });
  it('rejects invalid sources, map references, missing LUT/masks and changed asset identity', () => {
    let target = fixture();
    target.clips.c.in = 19;
    expect(
      planCutRestore(restoreState(), restoreCut(target), assets).available,
    ).toBe(false);
    target = fixture();
    target.clips.c.id = 'wrong';
    reason(fixture(), target, 'clip-key');
    target = fixture();
    target.clips.c.effects = [
      { id: 'lut', kind: 'lut', params: { assetId: 'missing' } },
    ];
    reason(fixture(), target, 'lut-missing');
    target = fixture();
    target.clips.c.mask = {
      kind: 'sam',
      maskAssetId: 'missing',
      invert: false,
      feather: 0,
    };
    reason(fixture(), target, 'mask-missing');
    const changedAssets = assets.map((a) => ({ ...a, url: '/new.mp4' }));
    const state = { ...restoreState(), assets: changedAssets };
    expect(
      planCutRestore(state, restoreCut(fixture()), changedAssets),
    ).toMatchObject({
      available: false,
      reasons: [
        { code: 'asset-identity-changed', message: expect.any(String) },
      ],
    });
  });
  it('rejects locked touched material, lock introduction, and busy/nonready authority', () => {
    const before = fixture();
    before.clips.c.locked = true;
    const target = fixture();
    target.clips.c.in = 2;
    reason(before, target, 'clip-locked');
    target.clips.c.locked = true;
    reason(fixture(), target, 'clip-locked');
    const state = restoreState();
    state.persistenceStatus = 'unavailable';
    expect(planCutRestore(state, restoreCut(fixture()), assets).available).toBe(
      false,
    );
    state.persistenceStatus = 'ready';
    state.pending = [
      { id: 'p', label: '', source: 'history', ops: [], status: 'unknown' },
    ];
    expect(planCutRestore(state, restoreCut(fixture()), assets).available).toBe(
      false,
    );
  });
  it('rejects wrong session/project and unknown wire fields without stripping them', () => {
    expect(
      planCutRestore(
        { ...restoreState(), sessionId: 'other' },
        restoreCut(fixture()),
        assets,
      ).available,
    ).toBe(false);
    const target = { ...fixture(), producerOnly: true };
    reason(fixture(), target, 'unavailable-wire-fields');
    target.id = 'other';
    reason(fixture(), target, 'project-mismatch');
  });
});
