import { describe, expect, it } from 'vitest';
import { normalizeTextStyleId, resolveText, textStyles } from './text-styles';
describe('eight in-video text styles', () => {
  it('ships exactly the specified family/size/weight/style combinations', () => {
    expect(
      Object.values(textStyles).map((s) => [
        s.id,
        s.fontFamily,
        s.fontSize,
        s.fontWeight,
        s.fontStyle,
      ]),
    ).toEqual([
      ['caption-clean', 'Geist', 56, 500, 'normal'],
      ['caption-pop', 'Anton', 72, 400, 'normal'],
      ['caption-box', 'Geist', 48, 500, 'normal'],
      ['title-serif', 'Instrument Serif', 120, 400, 'italic'],
      ['title-bold', 'Anton', 140, 400, 'normal'],
      ['lower-third', 'Geist', 40, 500, 'normal'],
      ['label-mono', 'Geist Mono', 32, 400, 'normal'],
      ['quote', 'DM Serif Display', 64, 400, 'normal'],
    ]);
    expect(textStyles['caption-clean'].stroke).toEqual({
      color: '#000000',
      alpha: 0.25,
      width: 2,
    });
    expect(textStyles['caption-box'].background?.alpha).toBe(0.7);
    expect(textStyles['caption-pop'].activeWordColor).toBe('#FFD84D');
    expect(textStyles['lower-third'].secondary).toEqual({
      fontFamily: 'Geist',
      fontWeight: 400,
      fontSize: 28,
    });
  });
  it('freezes shared registry constants at every mutable nested level', () => {
    expect(Object.isFrozen(textStyles)).toBe(true);
    for (const style of Object.values(textStyles)) {
      expect(Object.isFrozen(style)).toBe(true);
      if (style.stroke) expect(Object.isFrozen(style.stroke)).toBe(true);
      if (style.background)
        expect(Object.isFrozen(style.background)).toBe(true);
      if (style.secondary) expect(Object.isFrozen(style.secondary)).toBe(true);
    }
  });
  it('normalizes legacy aliases without modifying the source text', () => {
    expect(normalizeTextStyleId('title')).toBe('title-serif');
    expect(normalizeTextStyleId('caption')).toBe('caption-clean');
    expect(normalizeTextStyleId('lower_third')).toBe('lower-third');
    const text = { style: 'caption-pop' as const, content: 'hello World' };
    expect(resolveText(text, 0, 1920, 1080).content).toBe('HELLO WORLD');
    expect(text.content).toBe('hello World');
  });
  it('uses a 90% title-safe grid with uniform portrait scale and explicit anchors', () => {
    expect(
      resolveText({ style: 'caption', content: 'x' }, 0, 1920, 1080),
    ).toMatchObject({
      safeRect: { x: 96, y: 54, width: 1728, height: 972 },
      anchor: { x: 960, y: 1026 },
      scale: 1,
    });
    expect(
      resolveText({ style: 'title', content: 'x' }, 0, 1080, 1920),
    ).toMatchObject({
      safeRect: { x: 54, y: 96, width: 972, height: 1728 },
      anchor: { x: 540, y: 960 },
      scale: 0.5625,
    });
    expect(
      resolveText(
        { style: 'lower-third', content: 'name', secondaryContent: 'role' },
        0,
        1920,
        1080,
      ),
    ).toMatchObject({ secondaryContent: 'role', anchor: { x: 96, y: 1026 } });
  });
  it('uses half-open word times, preserves overlaps/order and excludes zero durations', () => {
    const text = {
      style: 'caption-pop' as const,
      content: 'a b c',
      words: [
        { t: 1, d: 1, w: 'a' },
        { t: 1.5, d: 1, w: 'b' },
        { t: 2, d: 0, w: 'c' },
      ],
    };
    expect(
      resolveText(text, 1.5, 1920, 1080).words.map((w) => w.active),
    ).toEqual([true, true, false]);
    expect(resolveText(text, 2, 1920, 1080).words.map((w) => w.active)).toEqual(
      [false, true, false],
    );
    expect(resolveText(text, 2, 1920, 1080).words.map((w) => w.text)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });
  it('returns independent style descriptors so consumers cannot mutate shared data through scenes', () => {
    const first = resolveText(
      { style: 'caption', content: 'x' },
      0,
      1920,
      1080,
    );
    first.style.fontSize = 1;
    expect(
      resolveText({ style: 'caption', content: 'x' }, 0, 1920, 1080).style
        .fontSize,
    ).toBe(56);
  });
});
