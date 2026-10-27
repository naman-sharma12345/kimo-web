import { describe, expect, it } from 'vitest';
import { applyOps } from '@kimo/client';
import { textUpdate } from '@/lib/editing/text';
import { fixture } from '@/lib/editing/test-fixtures';
import {
  captionClips,
  joinCaptions,
  replaceCaptions,
  retimeCaption,
  splitCaption,
  TEXT_STYLE_IDS,
  TEXT_ANIMATIONS,
} from './caption-commands';
describe('caption timing pipeline', () => {
  it('audits all eight canonical styles and five exact animations', () => {
    expect(TEXT_STYLE_IDS).toHaveLength(8);
    expect(TEXT_ANIMATIONS).toEqual([
      'none',
      'fade',
      'rise',
      'type on',
      'pop words',
    ]);
  });
  it('classifies caption semantics and excludes titles on a mixed text track', () => {
    const p = fixture();
    p.clips.title = {
      ...p.clips.t,
      id: 'title',
      text: { style: 'title-serif', content: 'title' },
    };
    expect(captionClips(p, 'txt').map((c) => c.id)).toEqual(['t']);
  });
  it('preserves t/d for same Unicode whitespace token count and punctuation, changed count starts at animation offset', () => {
    const p = fixture();
    const clip = { ...p.clips.t, animationOffsetSec: 7 };
    expect(textUpdate(clip, '你好，\t世界！').words).toEqual([
      { w: '你好，', t: 0, d: 1 },
      { w: '世界！', t: 1, d: 3 },
    ]);
    expect(textUpdate(clip, 'one\n two  three').words?.map((w) => w.t)).toEqual(
      [7, 7 + 4 / 3, 7 + 8 / 3],
    );
    expect(textUpdate(clip, ' \n\t').words).toEqual([]);
  });
  it('replace all is literal and immutable with core word timing update', () => {
    const p = fixture();
    const ops = replaceCaptions(p, ['t'], 'hello', 'a long hello');
    expect(ops).toHaveLength(1);
    expect(p.clips.t.text?.content).toBe('hello world');
    expect(applyOps(p, ops, 0).clips.t?.text?.words).toHaveLength(4);
    expect(replaceCaptions(p, ['t'], '', 'anything')).toEqual([]);
  });
  it('split and join preserve stable animation timings and reconstruct a segment', () => {
    const p = fixture();
    const split = splitCaption(p, 't', 1, 1, 'right');
    const parts = applyOps(p, split, 0);
    expect(parts.clips.t?.text?.content).toBe('hello');
    expect(parts.clips.right?.text?.content).toBe('world');
    expect(parts.clips.right?.animationOffsetSec).toBe(1);
    expect(parts.clips.right?.text?.words).toEqual([
      { w: 'world', t: 1, d: 3 },
    ]);
    const joined = applyOps(parts, joinCaptions(parts, 't', 'right'), 0);
    expect(joined.clips.t?.text).toEqual(p.clips.t.text);
    expect(joined.clips.t?.duration).toBe(4);
    expect(joined.clips.right).toBeUndefined();
  });
  it('join maps independent right caption timings to left clock, rejects gaps/styles', () => {
    const p = fixture();
    p.clips.r = {
      ...p.clips.t,
      id: 'r',
      start: 4,
      text: {
        style: 'caption-clean',
        content: 'next',
        words: [{ w: 'next', t: 0, d: 4 }],
      },
    };
    expect(
      applyOps(p, joinCaptions(p, 't', 'r'), 0).clips.t?.text?.words?.at(-1)?.t,
    ).toBe(4);
    p.clips.r.start = 5;
    expect(() => joinCaptions(p, 't', 'r')).toThrow('adjacent');
  });
  it('retimes through validated core trim and keeps offset clock', () => {
    const p = fixture();
    p.clips.t.animationOffsetSec = 3;
    const next = applyOps(p, retimeCaption(p, 't', 'out', 2), 0);
    expect(next.clips.t?.duration).toBe(2);
    expect(next.clips.t?.animationOffsetSec).toBe(3);
    expect(() => splitCaption(p, 't', 1, 0, 'x')).toThrow('boundary');
  });
});
