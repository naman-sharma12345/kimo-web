import { expect, it } from 'vitest';
import { applyOps, type KimoProject } from '@kimo/client';
import { fixture, assets } from '@/lib/editing/test-fixtures';
import { copyClips, pasteClips } from './edit-clipboard';
it('pastes the copied snapshot at the playhead even after the original is changed or removed', () => {
  const p: KimoProject = fixture();
  const copied = copyClips(p, ['c']);
  if (!copied) throw new Error('copy failed');
  const source = p.clips.c;
  if (!source) throw new Error('missing fixture clip');
  p.clips.c = { ...source, duration: 1 };
  delete p.clips.c;
  const ops = pasteClips(p, copied, 8, assets, () => 'pasted');
  const result = applyOps(p, ops, 0);
  expect(result.clips.pasted).toMatchObject({
    start: 8,
    duration: 4,
    id: 'pasted',
  });
  expect(p.clips.pasted).toBeUndefined();
});
it('respects current locked tracks and preserves copied timing offset with fresh identities', () => {
  const p: KimoProject = fixture();
  const copied = copyClips(p, ['c']);
  if (!copied) throw new Error('copy failed');
  p.tracks = p.tracks.map((track) => ({ ...track, locked: true }));
  expect(() => pasteClips(p, copied, 3, assets, () => 'pasted')).toThrow(
    'unlocked compatible',
  );
  expect(copyClips(p, [])).toBeNull();
});
