import { describe, expect, it } from 'vitest';
import { applyOps, type Clip, type Op } from '@kimo/client';
import { captureHistory, historyOps, mergeFieldIntent } from './history';
import { rebaseCommands } from './rebase';
import { fixture } from './test-fixtures';
const effects: Clip['effects'] = [
  { id: 'blur', kind: 'blur', params: { radius: 1 }, enabled: true },
  { id: 'grain', kind: 'grain', params: { amount: 0.2 }, enabled: true },
];
const keys: Clip['keyframes'] = [
  { property: 'x', time: 0, value: 0, easing: 'linear' },
  { property: 'x', time: 1, value: 10, easing: 'linear' },
];
describe('root keyed-array order intent', () => {
  it('preserves a pure effects reorder and concurrent same-ID parameters/enabled plus inserted agents', () => {
    const desired = [...effects].reverse();
    const current: Clip['effects'] = [
      { id: 'blur', kind: 'blur', params: { radius: 3 }, enabled: false },
      { id: 'agent', kind: 'sharpen', params: { amount: 1 } },
      { id: 'grain', kind: 'grain', params: { amount: 0.7 }, enabled: false },
    ];
    expect(mergeFieldIntent(effects, desired, current)).toEqual([
      current[2],
      current[1],
      current[0],
    ]);
    expect(effects.map((effect) => effect.id)).toEqual(['blur', 'grain']);
  });
  it('preserves a pure keyframe reorder while retaining newer values/easing and inserted keys', () => {
    const current: Clip['keyframes'] = [
      { property: 'x', time: 0, value: 4, easing: 'ease_out' },
      { property: 'rotation', time: 0.5, value: 45 },
      { property: 'x', time: 1, value: 20, easing: 'hold' },
    ];
    expect(mergeFieldIntent(keys, [...keys].reverse(), current)).toEqual([
      current[2],
      current[1],
      current[0],
    ]);
  });
});
describe('rebase preserves ordered wire patches', () => {
  it('keeps a pure effect reorder in the actual clip.update payload without reverting agent leaves', () => {
    const p = fixture();
    p.clips.c.effects = structuredClone(effects);
    const current = applyOps(
      p,
      [
        {
          op: 'clip.update',
          id: 'c',
          patch: {
            effects: [
              {
                id: 'blur',
                kind: 'blur',
                params: { radius: 5 },
                enabled: false,
              },
              {
                id: 'grain',
                kind: 'grain',
                params: { amount: 0.4 },
                enabled: true,
              },
            ],
          },
        },
      ],
      1,
    );
    const ops: Op[] = [
      {
        op: 'clip.update',
        id: 'c',
        patch: { effects: [...effects].reverse() },
      },
    ];
    const rebased = rebaseCommands(p, current, ops);
    expect(rebased).toEqual([
      {
        op: 'clip.update',
        id: 'c',
        patch: { effects: [...(current.clips.c?.effects ?? [])].reverse() },
      },
    ]);
    expect(
      applyOps(current, rebased).clips.c?.effects.map((effect) => effect.id),
    ).toEqual(['grain', 'blur']);
  });
  it('keeps a pure root keyframe reorder in clip.update and preserves authoritative scalar edits', () => {
    const p = fixture();
    p.clips.c.keyframes = structuredClone(keys);
    const currentKeys: Clip['keyframes'] = [
      { property: 'x', time: 0, value: 7 },
      { property: 'x', time: 1, value: 40, easing: 'ease_out' },
    ];
    const current = applyOps(
      p,
      [{ op: 'clip.update', id: 'c', patch: { keyframes: currentKeys } }],
      1,
    );
    const rebased = rebaseCommands(p, current, [
      { op: 'clip.update', id: 'c', patch: { keyframes: [...keys].reverse() } },
    ]);
    expect(rebased).toEqual([
      {
        op: 'clip.update',
        id: 'c',
        patch: { keyframes: [...currentKeys].reverse() },
      },
    ]);
  });
});
describe('ordered history inverses preserve concurrent element leaves', () => {
  it('undoes pure effect order without changing subsequent same-ID params/enabled', () => {
    const p = fixture();
    p.clips.c.effects = structuredClone(effects);
    const ops: Op[] = [
      {
        op: 'clip.update',
        id: 'c',
        patch: { effects: [...effects].reverse() },
      },
    ];
    const entry = captureHistory(p, ops, {
      id: 'order',
      label: 'reorder',
      author: 'user',
    });
    const currentEffects: Clip['effects'] = [
      { id: 'grain', kind: 'grain', params: { amount: 0.6 }, enabled: false },
      { id: 'blur', kind: 'blur', params: { radius: 6 }, enabled: false },
    ];
    const current = applyOps(applyOps(p, ops), [
      { op: 'clip.update', id: 'c', patch: { effects: currentEffects } },
    ]);
    expect(
      applyOps(current, historyOps(current, entry, 'undo')).clips.c?.effects,
    ).toEqual([...currentEffects].reverse());
  });
  it('undoes pure keyframe order without changing subsequent values/easing', () => {
    const p = fixture();
    p.clips.c.keyframes = structuredClone(keys);
    const ops: Op[] = [
      { op: 'clip.update', id: 'c', patch: { keyframes: [...keys].reverse() } },
    ];
    const entry = captureHistory(p, ops, {
      id: 'keys',
      label: 'key order',
      author: 'user',
    });
    const currentKeys: Clip['keyframes'] = [
      { property: 'x', time: 1, value: 60, easing: 'hold' },
      { property: 'x', time: 0, value: 2, easing: 'ease_out' },
    ];
    const current = applyOps(applyOps(p, ops), [
      { op: 'clip.update', id: 'c', patch: { keyframes: currentKeys } },
    ]);
    expect(
      applyOps(current, historyOps(current, entry, 'undo')).clips.c?.keyframes,
    ).toEqual([...currentKeys].reverse());
  });
});
