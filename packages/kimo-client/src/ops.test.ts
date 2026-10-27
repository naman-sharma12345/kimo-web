import { describe, expect, it } from 'vitest';
import type { Clip, KimoProject } from './schema';
import { applyOps } from './ops';
const clip: Clip = {
  id: 'c',
  trackId: 'v',
  kind: 'text',
  start: 10,
  duration: 8,
  in: 3,
  speed: 2,
  transform: { x: 0, y: 0, scale: 1, opacity: 1, rotation: 0 },
  effects: [],
  keyframes: [
    { property: 'x', time: 0, value: 0 },
    { property: 'x', time: 8, value: 80 },
  ],
  text: {
    style: 'caption',
    content: 'hello',
    words: [{ t: 5, d: 1, w: 'hello' }],
  },
};
const project: KimoProject = {
  id: 'p',
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 18,
  tracks: [],
  clips: { c: clip },
  markers: [],
};
describe('Phase 6 reducer vectors preserve established timing', () => {
  it('splits source time independently from the stable animation clock, repeatedly', () => {
    const once = applyOps(project, [
      { op: 'clip.split', id: 'c', at: 12, newId: 'r' },
    ]);
    expect(once.clips.c?.duration).toBe(2);
    expect(once.clips.r).toMatchObject({
      start: 12,
      in: 7,
      duration: 6,
      animationOffsetSec: 2,
    });
    expect(once.clips.r?.keyframes).toEqual(clip.keyframes);
    expect(once.clips.r?.text?.words).toEqual(clip.text?.words);
    const twice = applyOps(once, [
      { op: 'clip.split', id: 'r', at: 15, newId: 'rr' },
    ]);
    expect(twice.clips.rr).toMatchObject({
      start: 15,
      in: 13,
      duration: 3,
      animationOffsetSec: 5,
    });
    expect(project.clips.c).toEqual(clip);
    expect(twice.duration).toBe(18);
  });
  it('keeps legacy trim-at-speed formulas and does not silently rebase animation', () => {
    const trimmed = applyOps(project, [
      { op: 'clip.trim', id: 'c', edge: 'in', value: 7 },
    ]);
    expect(trimmed.clips.c).toMatchObject({ start: 12, in: 7, duration: 6 });
    expect(trimmed.clips.c?.animationOffsetSec).toBeUndefined();
    expect(trimmed.clips.c?.keyframes).toEqual(clip.keyframes);
    const out = applyOps(project, [
      { op: 'clip.trim', id: 'c', edge: 'out', value: 11 },
    ]);
    expect(out.clips.c?.duration).toBe(4);
  });
  it('preserves shallow nested patch semantics and effect replacement order', () => {
    const updated = applyOps(project, [
      {
        op: 'clip.update',
        id: 'c',
        patch: { text: { content: 'new', style: 'title-bold' } },
      },
      {
        op: 'effect.set',
        clipId: 'c',
        effect: { id: 'a', kind: 'blur', params: {} },
      },
      {
        op: 'effect.set',
        clipId: 'c',
        effect: { id: 'b', kind: 'grain', params: {} },
      },
      {
        op: 'effect.set',
        clipId: 'c',
        effect: { id: 'a', kind: 'blur', params: { sigma: 2 } },
      },
    ]);
    expect(updated.clips.c?.text).toEqual({
      content: 'new',
      style: 'title-bold',
    });
    expect(updated.clips.c?.effects.map((effect) => effect.id)).toEqual([
      'b',
      'a',
    ]);
  });
  it('ignores split endpoints and missing clips, preserving additive fields', () => {
    const withOffset = {
      ...project,
      clips: { c: { ...clip, animationOffsetSec: 4 } },
    };
    for (const at of [10, 18, 0, 30])
      expect(
        applyOps(withOffset, [{ op: 'clip.split', id: 'c', at, newId: 'r' }])
          .clips.r,
      ).toBeUndefined();
    expect(
      applyOps(withOffset, [{ op: 'clip.split', id: 'c', at: 12, newId: 'r' }])
        .clips.r?.animationOffsetSec,
    ).toBe(6);
  });
});
