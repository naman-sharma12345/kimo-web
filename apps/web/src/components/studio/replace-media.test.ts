import { expect, it } from 'vitest';
import { applyOps, type Asset } from '@kimo/client';
import { fixture, assets } from '@/lib/editing/test-fixtures';
import { replaceMedia } from './replace-media';
const replacement: Asset = {
  id: 'new',
  kind: 'video',
  name: 'new clip',
  url: '/new',
  source: 'user',
  durationSec: 2,
};
it('retains placement/style and clamps replacement to actual source headroom', () => {
  const p = fixture();
  const next = applyOps(
    p,
    replaceMedia(p, 'c', replacement, [...assets, replacement]),
    0,
  );
  expect(next.clips.c).toMatchObject({
    id: 'c',
    assetId: 'new',
    start: 0,
    in: 1,
    duration: 1,
    transform: p.clips.c.transform,
  });
  expect(p.clips.c.assetId).toBe('a');
});
it('rejects missing source duration, cross-kind assets and locked edits', () => {
  const p = fixture();
  expect(() =>
    replaceMedia(p, 'c', { ...replacement, durationSec: undefined }, [
      ...assets,
      replacement,
    ]),
  ).toThrow('duration');
  expect(() =>
    replaceMedia(p, 'c', { ...replacement, kind: 'image' }, assets),
  ).toThrow('same kind');
  p.clips.c.locked = true;
  expect(() =>
    replaceMedia(p, 'c', replacement, [...assets, replacement]),
  ).toThrow('locked');
});
it('does not create invalid sub-frame replacement ops', () => {
  expect(() =>
    replaceMedia(fixture(), 'c', { ...replacement, durationSec: 0.001 }, [
      ...assets,
      replacement,
    ]),
  ).toThrow('one frame');
});
