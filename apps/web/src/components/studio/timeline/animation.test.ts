import { describe, expect, it } from 'vitest';
import { AgentClipMotion } from './animation';
import { clip } from './test-fixtures';
describe('authoritative agent motion', () => {
  it('grows actual created clips from zero using snappy spring parameters', () => {
    const motion = new AgentClipMotion();
    const c = clip();
    motion.apply([], [c], [{ op: 'clip.add', clip: c }], 0);
    expect(motion.frame(0, 0, false)[0]?.duration).toBe(0);
    expect(motion.frame(16, 16, false)[0]?.duration).toBeGreaterThan(0);
    for (let t = 32; t <= 2000; t += 16) motion.frame(t, 16, false);
    expect(motion.active).toBe(false);
  });
  it('keeps deleted metadata only until the 220ms exit and never mutates entities', () => {
    const c = clip();
    const original = structuredClone(c);
    const motion = new AgentClipMotion();
    motion.apply([c], [], [{ op: 'clip.remove', id: c.id }], 0);
    expect(motion.frame(110, 16, false)[0]).toMatchObject({
      duration: 1.5,
      opacity: 0.5,
    });
    expect(motion.frame(220, 16, false)).toEqual([]);
    expect(c).toEqual(original);
  });
  it('reduced motion keeps exit geometry fixed and skips movement', () => {
    const a = clip();
    const b = clip('a', { start: 12 });
    const motion = new AgentClipMotion();
    motion.apply(
      [a],
      [b],
      [{ op: 'clip.move', id: 'a', trackId: 'v', start: 12 }],
      0,
    );
    expect(motion.frame(16, 16, true)[0]?.start).toBe(12);
    motion.frame(140, 16, true);
    expect(motion.active).toBe(false);
    motion.apply([a], [], [{ op: 'clip.remove', id: 'a' }], 0);
    expect(motion.frame(70, 16, true)[0]).toMatchObject({
      duration: 3,
      opacity: 0.5,
    });
  });
});
