import { describe, it, expect } from 'vitest';
import {
  serializeSegments,
  readSegments,
  slashCommand,
  mentionQuery,
} from './composer-model';
describe('composer pure model', () => {
  it('serializes typed segments and actual clip names without a wire mention format', () => {
    expect(
      serializeSegments([
        { type: 'text', text: 'trim ' },
        { type: 'mention', clipId: 'c1', name: 'beach_02.mp4' },
        { type: 'text', text: ' now' },
      ]),
    ).toBe('trim beach_02.mp4 now');
  });
  it('reads real atomic DOM chips without taking display markup as transport', () => {
    const root = document.createElement('div');
    root.innerHTML =
      'trim <span data-clip-id="c1" data-clip-name="actual.mov" contenteditable="false">actual.mov</span><br>next';
    expect(readSegments(root)).toEqual([
      { type: 'text', text: 'trim ' },
      { type: 'mention', clipId: 'c1', name: 'actual.mov' },
      { type: 'text', text: '\n' },
      { type: 'text', text: 'next' },
    ]);
  });
  it('only dispatches exact slash commands', () => {
    expect(slashCommand(' /pause ')).toBe('pause');
    expect(slashCommand('/resume')).toBe('resume');
    expect(slashCommand('/undo-last')).toBe('undo-last');
    expect(slashCommand('/render')).toBe('render');
    expect(slashCommand('/pause later')).toBeUndefined();
    expect(slashCommand('/unknown')).toBeUndefined();
  });
  it('recognizes mention query only at a word boundary', () => {
    expect(mentionQuery('trim @bea')).toEqual({ start: 5, query: 'bea' });
    expect(mentionQuery('me@example')).toBeUndefined();
    expect(mentionQuery('@')).toEqual({ start: 0, query: '' });
  });
});
