import { expect, it } from 'vitest';
import { viewerTransform } from './viewer-transform';
const base = { x: 10, y: 20, scale: 2, rotation: 15, opacity: 0.5 };
it('maps screen deltas to project coordinates without disturbing rotation, scale or opacity', () => {
  expect(
    viewerTransform(
      base,
      'move',
      { x: 20, y: 40 },
      { x: 40, y: 50 },
      { x: 0, y: 0 },
      0.5,
    ),
  ).toEqual({ ...base, x: 50, y: 40 });
});
it('scales radially and rotates around the actual project-space anchor in screen coordinates', () => {
  expect(
    viewerTransform(
      base,
      'scale',
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 0 },
      1,
    ).scale,
  ).toBe(4);
  expect(
    viewerTransform(
      base,
      'rotate',
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      1,
    ).rotation,
  ).toBe(105);
});
it('rejects unavailable geometry rather than generating invalid ops', () => {
  expect(() =>
    viewerTransform(
      base,
      'move',
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      0,
    ),
  ).toThrow('not ready');
});
