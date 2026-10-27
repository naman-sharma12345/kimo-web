import { describe, expect, it } from 'vitest';
import { applyOps, type Op } from '@kimo/client';
import { assets, fixture, title } from './test-fixtures';
import {
  deleteClips,
  detachAudio,
  duplicateClips,
  moveClips,
  setGlobalAudio,
  slipClip,
  speedClip,
  splitClips,
  trimClip,
  validateCommands,
} from './commands';
import { displayTracks, mainVideoTrack } from './display';
import { textUpdate } from './text';
const edited = (ops: Op[]) => applyOps(fixture(), ops, 0);
describe('pure edit commands', () => {
  it('snaps movement to project frames and clamps at timeline zero', () => {
    expect(edited(moveClips(fixture(), ['c'], -10)).clips.c?.start).toBe(0);
    expect(
      edited(moveClips(fixture(), ['c'], 0.04)).clips.c?.start,
    ).toBeCloseTo(1 / 30);
  });
  it('rejects cross-kind, locked track, and clip movement for numeric and gesture paths alike', () => {
    expect(() => moveClips(fixture(), ['c'], 1, 'txt')).toThrow('same kind');
    const p = fixture();
    p.clips.c = { ...p.clips.c, locked: true };
    expect(() => moveClips(p, ['c'], 1)).toThrow('locked');
    expect(() =>
      validateCommands(p, [
        { op: 'clip.update', id: 'c', patch: { start: 2 } },
      ]),
    ).toThrow('locked');
    expect(
      validateCommands(p, [
        { op: 'clip.update', id: 'c', patch: { locked: false } },
      ]),
    ).toHaveLength(1);
  });
  it('clamps trim to one frame, zero/source boundary, and keeps trim-at-speed semantics', () => {
    const p = fixture();
    const left = applyOps(p, trimClip(p, 'c', 'in', 100, { assets }), 0).clips
      .c;
    expect(left?.duration).toBeCloseTo(1 / 30);
    expect(
      applyOps(p, trimClip(p, 'c', 'out', 100, { assets }), 0).clips.c
        ?.duration,
    ).toBe(19);
    expect(
      applyOps(p, trimClip(p, 'c', 'in', -100, { assets }), 0).clips.c?.start,
    ).toBe(0);
  });
  it('ripple-trims from a baseline and shifts only later same-track clips', () => {
    const p = fixture();
    p.clips.next = { ...p.clips.c, id: 'next', start: 4 };
    const next = applyOps(
      p,
      trimClip(p, 'c', 'in', 2, { ripple: true, assets }),
      0,
    );
    expect(next.clips.c).toMatchObject({ in: 2, start: 0, duration: 3 });
    expect(next.clips.next?.start).toBe(3);
    expect(next.clips.t?.start).toBe(0);
  });
  it('closes deleted interval union once on V1, and always lifts on other tracks', () => {
    const p = fixture();
    p.clips.two = { ...p.clips.c, id: 'two', start: 2, duration: 4 };
    p.clips.next = { ...p.clips.c, id: 'next', start: 8 };
    expect(applyOps(p, deleteClips(p, ['c', 'two']), 0).clips.next?.start).toBe(
      2,
    );
    expect(
      applyOps(p, deleteClips(p, ['c', 'two'], { lift: true }), 0).clips.next
        ?.start,
    ).toBe(8);
    expect(applyOps(p, deleteClips(p, ['t']), 0).clips.c?.start).toBe(0);
  });
  it('splits only interior frames and preserves animation clock, transitions, and action-independent data', () => {
    const p = fixture();
    p.clips.c = {
      ...p.clips.c,
      speed: 2,
      animationOffsetSec: 3,
      transitionIn: { kind: 'crossfade', durationFrames: 12 },
    };
    expect(splitClips(p, ['c'], 0)).toEqual([]);
    expect(splitClips(p, ['c'], 4)).toEqual([]);
    const next = applyOps(
      p,
      splitClips(p, ['c'], 1, () => 'right'),
      0,
    );
    expect(next.clips.right).toMatchObject({
      in: 3,
      start: 1,
      duration: 3,
      animationOffsetSec: 4,
      transitionIn: p.clips.c.transitionIn,
    });
    expect(
      splitClips(
        fixture(),
        [],
        1,
        (() => {
          let n = 0;
          return () => `s${++n}`;
        })(),
      ),
    ).toHaveLength(2);
  });
  it('duplicates with fresh clip/effect IDs and remaps effect keyframe paths', () => {
    const p = fixture();
    p.clips.c = {
      ...p.clips.c,
      effects: [{ id: 'blur', kind: 'blur', params: { radius: 2 } }],
      keyframes: [{ property: 'effects.blur.radius', time: 0, value: 2 }],
    };
    let n = 0;
    const next = applyOps(
      p,
      duplicateClips(p, ['c'], () => `id${++n}`),
      0,
    );
    expect(next.clips.id1?.start).toBe(4);
    expect(next.clips.id1?.effects[0]?.id).toBe('id2');
    expect(next.clips.id1?.keyframes[0]?.property).toBe('effects.id2.radius');
  });
  it('preserves source span on speed changes and bounds slip without moving', () => {
    expect(edited(speedClip(fixture(), 'c', 2, assets)).clips.c).toMatchObject({
      start: 0,
      in: 1,
      duration: 2,
      speed: 2,
    });
    expect(edited(slipClip(fixture(), 'c', 100, assets)).clips.c).toMatchObject(
      { start: 0, in: 16, duration: 4 },
    );
    expect(() => speedClip(fixture(), 'c', 0)).toThrow();
    expect(
      edited(speedClip(fixture(), 'c', 1000)).clips.c?.duration,
    ).toBeCloseTo(1 / 30);
  });
  it('detaches to existing audio track atomically, mutes only the original, and links both', () => {
    let n = 0;
    const next = edited(detachAudio(fixture(), 'c', () => `new${++n}`));
    const copy = Object.values(next.clips).find((c) => c.kind === 'audio');
    expect(copy).toMatchObject({
      trackId: 'aud',
      volume: 1,
      in: 1,
      duration: 4,
    });
    expect(next.clips.c?.volume).toBe(0);
    expect(copy?.linkGroupId).toBe(next.clips.c?.linkGroupId);
    expect(
      edited(setGlobalAudio(fixture(), true)).tracks.find((t) => t.id === 'v')
        ?.muted,
    ).toBe(true);
  });
  it('orders headers without mutating compositor layer order, selecting V1 deterministically', () => {
    const p = fixture();
    const order = p.tracks.map((t) => t.id);
    expect(mainVideoTrack(p)?.id).toBe('v');
    expect(displayTracks(p)[0]?.kind).toBe('text');
    expect(p.tracks.map((t) => t.id)).toEqual(order);
  });
  it('validates finite values, crop, source limits, duration and dangling references at commit boundary', () => {
    for (const patch of [
      { duration: 0 },
      { start: Infinity },
      { trackId: 'missing' },
      { duration: 30 },
      {
        transform: {
          ...fixture().clips.c.transform,
          crop: { l: 0.5, r: 0.5, t: 0, b: 0 },
        },
      },
    ])
      expect(() =>
        validateCommands(
          fixture(),
          [{ op: 'clip.update', id: 'c', patch }],
          assets,
        ),
      ).toThrow();
  });
});
describe('single text-update timing contract', () => {
  it('keeps same-count timings per index and updates secondary content in one op', () => {
    expect(textUpdate(title, 'good morning', 'secondary')).toEqual({
      op: 'text.update',
      clipId: 't',
      content: 'good morning',
      secondaryContent: 'secondary',
      words: [
        { w: 'good', t: 0, d: 1 },
        { w: 'morning', t: 1, d: 3 },
      ],
    });
  });
  it('redistributes changed word count over the split animation offset, not global start/source in', () => {
    const op = textUpdate(
      { ...title, start: 40, in: 20, animationOffsetSec: 5, duration: 3 },
      'one two three',
    );
    expect(op.words).toEqual([
      { w: 'one', t: 5, d: 1 },
      { w: 'two', t: 6, d: 1 },
      { w: 'three', t: 7, d: 1 },
    ]);
    expect(textUpdate(title, '   ').words).toEqual([]);
  });
});
