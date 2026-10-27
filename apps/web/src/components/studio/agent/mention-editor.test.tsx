import * as React from 'react';
import { createRef } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MentionEditor } from './mention-editor';
import type { MentionEditorHandle } from './mention-editor';
import { serializeSegments } from '@/lib/agent/composer-model';
afterEach(cleanup);
function caret(element: HTMLElement, offset?: number) {
  const range = document.createRange();
  const node = element.firstChild ?? element;
  range.setStart(node, offset ?? node.textContent?.length ?? 0);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
const clips = [
  { id: 'c1', name: 'beach_02', thumbUrl: '/beach.jpg' },
  { id: 'c2', name: 'city' },
];
function setup() {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const onEscape = vi.fn();
  const ref = createRef<MentionEditorHandle>();
  render(
    <MentionEditor
      ref={ref}
      clips={clips}
      placeholder="tell kimo what to change…"
      onChange={onChange}
      onSubmit={onSubmit}
      onEscape={onEscape}
    />,
  );
  return {
    onChange,
    onSubmit,
    onEscape,
    ref,
    editor: screen.getByRole('textbox'),
  };
}
function typeQuery(editor: HTMLElement, value = '@bea') {
  editor.textContent = value;
  caret(editor);
  fireEvent.input(editor);
}
describe('real contenteditable mentions', () => {
  it('creates a real noneditable chip with actual clip identity, thumbnail and trailing caret', () => {
    const { editor, onChange } = setup();
    expect(editor).toHaveAttribute('contenteditable', 'true');
    typeQuery(editor);
    expect(screen.getByRole('option')).toHaveTextContent('beach_02');
    expect(screen.getByAltText('')).toHaveAttribute('src', '/beach.jpg');
    fireEvent.keyDown(editor, { key: 'Enter' });
    const chip = editor.querySelector('[data-clip-id="c1"]');
    expect(chip).toHaveAttribute('contenteditable', 'false');
    expect(serializeSegments(onChange.mock.lastCall?.[0] ?? [])).toBe(
      'beach_02 ',
    );
    expect(window.getSelection()?.anchorOffset).toBe(1);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
  it('navigates listbox with active descendant and consumes first Escape', () => {
    const { editor, onEscape } = setup();
    typeQuery(editor, '@');
    fireEvent.keyDown(editor, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(editor.getAttribute('aria-activedescendant')).toBe(
      screen.getAllByRole('option')[1]?.id,
    );
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
  it('does not choose or submit during IME composition', () => {
    const { editor, onSubmit } = setup();
    typeQuery(editor);
    fireEvent.compositionStart(editor);
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true });
    expect(editor.querySelector('[data-clip-id]')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(editor);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
  it('pastes multiline plaintext and not executable markup, preserving caret', () => {
    const { editor, onChange } = setup();
    editor.focus();
    caret(editor, 0);
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) =>
          type === 'text/plain' ? 'line 1\n<script>x</script>' : '<img src=x>',
      },
    });
    expect(editor.textContent).toBe('line 1\n<script>x</script>');
    expect(editor.querySelector('script')).toBeNull();
    expect(serializeSegments(onChange.mock.lastCall?.[0] ?? [])).toBe(
      'line 1\n<script>x</script>',
    );
  });
  it.each(['Backspace', 'Delete'])(
    'deletes a mention atomically with %s',
    (key) => {
      const { editor, onChange } = setup();
      typeQuery(editor);
      fireEvent.keyDown(editor, { key: 'Enter' });
      const chip = editor.querySelector('[data-clip-id]');
      expect(chip).not.toBeNull();
      const range = document.createRange();
      if (chip) {
        if (key === 'Backspace') range.setStartAfter(chip);
        else range.setStartBefore(chip);
      }
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      fireEvent.keyDown(editor, { key });
      expect(editor.querySelector('[data-clip-id]')).toBeNull();
      expect(serializeSegments(onChange.mock.lastCall?.[0] ?? [])).toBe(' ');
    },
  );
  it('exposes real focus/prefill handle and leaves parent Mod+Enter dispatch alone', () => {
    const { ref, editor, onSubmit } = setup();
    ref.current?.prefill('actual text');
    expect(editor).toHaveFocus();
    expect(editor).toHaveTextContent('actual text');
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    const parent = vi.fn((event: Event) => {
      expect(event.defaultPrevented).toBe(false);
    });
    document.addEventListener('keydown', parent);
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    document.removeEventListener('keydown', parent);
    expect(parent).toHaveBeenCalledTimes(1);
  });
  it('local Mod+Enter submits once and does not bubble to a parent', () => {
    const parent = vi.fn();
    const submit = vi.fn();
    render(
      <MentionEditor
        clips={[]}
        placeholder="message"
        onChange={() => {}}
        onSubmit={submit}
        parentHandlesModEnter={false}
      />,
    );
    document.addEventListener('keydown', parent);
    fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      ctrlKey: true,
    });
    document.removeEventListener('keydown', parent);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
  });
});
