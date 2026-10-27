import { describe, expect, it, vi } from 'vitest';
import {
  isAttachShortcut,
  matchStudioShortcut,
  registerStudioKeyboard,
  studioShortcuts,
} from './keyboard';
function key(
  key: string,
  options: KeyboardEventInit = {},
  target?: HTMLElement,
) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
}
describe('central studio keyboard registry', () => {
  it('preserves the landing attachment shortcut', () => {
    expect(isAttachShortcut({ key: 'U', ctrlKey: true, metaKey: false })).toBe(
      true,
    );
  });
  it('has no conflicting key/modifier chords', () => {
    const signatures = studioShortcuts.map(
      (s) => `${s.key.toLowerCase()}:${!!s.mod}:${!!s.shift}`,
    );
    expect(new Set(signatures).size).toBe(signatures.length);
  });
  it.each(['input', 'textarea', 'select'])('guards typing in %s', (tag) => {
    const target = document.createElement(tag);
    expect(matchStudioShortcut(key(' ', {}, target))).toBeUndefined();
    expect(matchStudioShortcut(key('k', { metaKey: true }, target))?.id).toBe(
      'composer',
    );
    expect(
      matchStudioShortcut(key('Enter', { ctrlKey: true }, target))?.id,
    ).toBe('submit');
    expect(matchStudioShortcut(key('Escape', {}, target))?.id).toBe('escape');
    expect(
      matchStudioShortcut(key('.', { metaKey: true }, target)),
    ).toBeUndefined();
  });
  it('guards nested contenteditable targets and IME composition', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editor.append(child);
    expect(matchStudioShortcut(key('v', {}, child))).toBeUndefined();
    expect(
      matchStudioShortcut(key('v', { isComposing: true })),
    ).toBeUndefined();
    expect(matchStudioShortcut(key('v', { altKey: true }))).toBeUndefined();
  });
  it('distinguishes tools from paste, shuttle from composer and shifted commands', () => {
    expect(matchStudioShortcut(key('v'))?.id).toBe('v');
    expect(matchStudioShortcut(key('v', { metaKey: true }))?.id).toBe('edit-v');
    expect(matchStudioShortcut(key('k'))?.id).toBe('shuttle-k');
    expect(matchStudioShortcut(key('K', { metaKey: true }))?.id).toBe(
      'composer',
    );
    expect(
      matchStudioShortcut(key('Z', { metaKey: true, shiftKey: true }))?.id,
    ).toBe('redo');
    expect(matchStudioShortcut(key('Z', { shiftKey: true }))?.id).toBe('fit');
    expect(matchStudioShortcut(key('ArrowRight', { shiftKey: true }))?.id).toBe(
      'second-next',
    );
    expect(matchStudioShortcut(key('?', { shiftKey: true }))?.id).toBe('help');
  });
  it('registers once, prevents only handled keys, and cleans up', () => {
    const run = vi.fn((id: string) => (id === 'play' ? undefined : false));
    const remove = registerStudioKeyboard(run);
    const play = key(' ');
    window.dispatchEvent(play);
    expect(play.defaultPrevented).toBe(true);
    const skip = key('v');
    window.dispatchEvent(skip);
    expect(skip.defaultPrevented).toBe(false);
    remove();
    window.dispatchEvent(key(' '));
    expect(run).toHaveBeenCalledTimes(2);
  });
});
