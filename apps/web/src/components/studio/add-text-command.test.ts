import { expect, it } from 'vitest';
import { applyOps } from '@kimo/client';
import { fixture } from '@/lib/editing/test-fixtures';
import { addTextAtPlayhead } from './add-text-command';
it('creates the exact three-second caption-clean text at a snapped playhead on an unlocked text track', () => {
  const p = fixture();
  const { clipId, ops } = addTextAtPlayhead(p, 2.04, () => 'new-text');
  expect(ops).toHaveLength(1);
  expect(applyOps(p, ops, 0).clips[clipId]).toMatchObject({
    start: 61 / 30,
    duration: 3,
    text: { style: 'caption-clean', content: 'your text' },
    trackId: 'txt',
  });
  expect(p.clips['new-text']).toBeUndefined();
});
it('creates a new text track atomically instead of writing to a locked existing one', () => {
  const p = fixture();
  p.tracks = p.tracks.map((track) => ({ ...track, locked: true }));
  let id = 0;
  const result = addTextAtPlayhead(p, 0, () => `fresh-${++id}`);
  expect(result.ops.map((op) => op.op)).toEqual(['track.add', 'clip.add']);
  expect(applyOps(p, result.ops, 0).clips[result.clipId]?.trackId).toBe(
    'fresh-1',
  );
});
