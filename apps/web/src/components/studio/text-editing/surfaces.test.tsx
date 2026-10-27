import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectorTextField } from './inspector-text-field';
import { TimelineTextEditor } from './timeline-text-editor';
import { ViewerTextEditor, viewerRegionStyle } from './viewer-text-editor';
import { CaptionsEditor } from './captions-editor';
import type { ViewerTextLayout } from './types';
import { setupText } from './test-helpers';
const layout: ViewerTextLayout = {
  status: 'ready',
  sceneWidth: 1920,
  sceneHeight: 1080,
  displayScale: 0.5,
  letterbox: { x: 20, y: 40 },
  transform: { x: 10, y: 15, scale: 1.2, rotation: 30, opacity: 1 },
  primary: {
    bounds: { x: -100, y: -50, width: 200, height: 80 },
    style: {
      fontFamily: 'Geist',
      fontSize: 56,
      fontWeight: 500,
      fontStyle: 'normal',
      lineHeight: 60,
      letterSpacing: 0,
      color: 'white',
      textAlign: 'center',
    },
  },
};
afterEach(() => vi.useRealTimers());
function inputContent(node: HTMLElement, text: string) {
  node.textContent = text;
  fireEvent.input(node);
}
describe('text fields', () => {
  it('initially selects all without scrolling and protects native caret/keyboard bubbling', async () => {
    const { editing, project } = await setupText();
    const parent = vi.fn();
    document.addEventListener('keydown', parent);
    render(<TimelineTextEditor editing={editing} clip={project.clips.t} />);
    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe('hello world'.length);
    field.setSelectionRange(3, 3);
    fireEvent.keyDown(field, { key: 'ArrowLeft' });
    expect(parent).not.toHaveBeenCalled();
    document.removeEventListener('keydown', parent);
    fireEvent.change(field, { target: { value: 'new text' } });
    field.setSelectionRange(2, 2);
    const draft = editing.getState().draft;
    if (!draft) throw new Error('expected active draft');
    act(() => editing.previewEdit(draft.id, []));
    expect(field.selectionStart).toBe(2);
    editing.dispose();
  });
  it('inspector and secondary field use one shared live pending value and one blur commit', async () => {
    const { editing, project, ops } = await setupText();
    vi.useFakeTimers();
    render(
      <>
        <InspectorTextField
          editing={editing}
          clip={project.clips.t}
          label="first"
        />
        <InspectorTextField
          editing={editing}
          clip={project.clips.t}
          label="mirror"
        />
        <InspectorTextField
          editing={editing}
          clip={project.clips.t}
          field="secondaryContent"
        />
      </>,
    );
    const first = screen.getByRole('textbox', { name: 'first' }),
      mirror = screen.getByRole('textbox', { name: 'mirror' }),
      second = screen.getByRole('textbox', { name: 'secondary text' });
    fireEvent.focus(first);
    fireEvent.change(first, { target: { value: 'draft primary' } });
    expect(mirror).toHaveValue('draft primary');
    fireEvent.blur(first, { relatedTarget: second });
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: 'draft secondary' } });
    fireEvent.blur(second, { relatedTarget: document.body });
    await act(async () => vi.runAllTimersAsync());
    expect(ops).toHaveBeenCalledTimes(1);
    expect(ops.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({
        content: 'draft primary',
        secondaryContent: 'draft secondary',
      }),
    ]);
    act(() => editing.dispose());
  });
  it('composition Enter/Escape cannot commit/cancel; end + blur commits exactly once', async () => {
    const { editing, project, ops } = await setupText();
    vi.useFakeTimers();
    const finish = vi.fn();
    render(
      <TimelineTextEditor
        editing={editing}
        clip={project.clips.t}
        onFinish={finish}
      />,
    );
    const field = screen.getByRole('textbox');
    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: 'にほん' } });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(finish).not.toHaveBeenCalled();
    expect(ops).not.toHaveBeenCalled();
    fireEvent.blur(field, { relatedTarget: document.body });
    fireEvent.compositionEnd(field);
    await act(async () => vi.runAllTimersAsync());
    expect(ops).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    act(() => editing.dispose());
  });
  it('timeline Escape cancels timers, restores text and finishes once', async () => {
    const { editing, project, ops } = await setupText();
    vi.useFakeTimers();
    const finish = vi.fn();
    render(
      <TimelineTextEditor
        editing={editing}
        clip={project.clips.t}
        onFinish={finish}
      />,
    );
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'cancel' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    fireEvent.blur(field);
    await act(async () => vi.runAllTimersAsync());
    expect(ops).not.toHaveBeenCalled();
    expect(field).toHaveValue('hello world');
    expect(finish).toHaveBeenCalledOnce();
    act(() => editing.dispose());
  });
  it('non-text clips never expose an inline editing control', async () => {
    const { editing, project } = await setupText();
    render(<TimelineTextEditor editing={editing} clip={project.clips.c} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    editing.dispose();
  });
});
describe('viewer editing', () => {
  it('uses injected measured transform/loaded font with letterbox; selects initial content and hides/restores once', async () => {
    const { editing, project } = await setupText();
    const hide = vi.fn(),
      finish = vi.fn();
    const { unmount } = render(
      <ViewerTextEditor
        editing={editing}
        clip={project.clips.t}
        active
        layout={layout}
        onTransientHide={hide}
        onFinish={finish}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'viewer text content' });
    expect(window.getSelection()?.toString()).toBe('hello world');
    expect(field).toHaveStyle({
      left: '-100px',
      top: '-50px',
      fontSize: '56px',
      fontFamily: 'Geist',
    });
    expect(field.parentElement?.style.transform).toBe(
      'scale(0.5) translate(10px, 15px) rotate(30deg) scale(1.2)',
    );
    expect(field.parentElement).toHaveStyle({ left: '500px', top: '310px' });
    expect(hide).toHaveBeenCalledWith('t', true);
    fireEvent.keyDown(field, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    expect(finish).toHaveBeenCalledExactlyOnceWith('cancel');
    expect(hide.mock.calls).toEqual([
      ['t', true],
      ['t', false],
    ]);
    unmount();
    expect(hide).toHaveBeenCalledTimes(2);
    editing.dispose();
  });
  it('font pending leaves preview visible and creates no edit authority', async () => {
    const { editing, project } = await setupText();
    const hide = vi.fn();
    render(
      <ViewerTextEditor
        editing={editing}
        clip={project.clips.t}
        active
        layout={{ ...layout, status: 'font-pending' }}
        onTransientHide={hide}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('waiting for font');
    expect(hide).not.toHaveBeenCalled();
    expect(editing.getState().draft).toBeNull();
    editing.dispose();
  });
  it('title Enter inserts newline while caption Enter commits; paste is plain text at native range', async () => {
    const { editing, project, ops } = await setupText();
    vi.useFakeTimers();
    if (!project.clips.t.text) throw new Error('expected text fixture');
    project.clips.t.text.style = 'title-bold';
    // Session projection is authoritative: install the title style before mounting.
    editing.replaceSnapshot({ project, assets: [] });
    const hide = vi.fn();
    render(
      <ViewerTextEditor
        editing={editing}
        clip={project.clips.t}
        active
        layout={layout}
        onTransientHide={hide}
      />,
    );
    const field = screen.getByRole('textbox');
    fireEvent.paste(field, {
      clipboardData: {
        getData: (format: string) =>
          format === 'text/plain' ? 'plain\ntext' : '<b>ignored</b>',
      },
    });
    expect(field.textContent).toBe('plain\ntext');
    expect(field.querySelector('b')).toBeNull();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field.textContent).toBe('plain\ntext\n');
    expect(ops).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    await act(async () => vi.runAllTimersAsync());
    expect(ops).toHaveBeenCalledTimes(1);
    expect(ops.mock.calls[0]?.[1][0]).toMatchObject({
      content: 'plain\ntext\n',
    });
    act(() => editing.dispose());
  });
  it('caption IME Escape is ignored; composition end + Enter commits once and cancels idle', async () => {
    const { editing, project, ops } = await setupText();
    vi.useFakeTimers();
    const finish = vi.fn();
    render(
      <ViewerTextEditor
        editing={editing}
        clip={project.clips.t}
        active
        layout={layout}
        onTransientHide={vi.fn()}
        onFinish={finish}
      />,
    );
    const field = screen.getByRole('textbox');
    fireEvent.compositionStart(field);
    inputContent(field, '世界');
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(finish).not.toHaveBeenCalled();
    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.pointerDown(document.body);
    await act(async () => vi.runAllTimersAsync());
    expect(finish).toHaveBeenCalledExactlyOnceWith('commit');
    expect(ops).toHaveBeenCalledTimes(1);
    act(() => editing.dispose());
  });
  it('lower third primary and secondary edit in one group; unmount cancels dirty timers and restores persisted preview', async () => {
    const { editing, project, ops } = await setupText();
    vi.useFakeTimers();
    const hide = vi.fn();
    const { unmount } = render(
      <ViewerTextEditor
        editing={editing}
        clip={project.clips.t}
        active
        layout={{
          ...layout,
          secondary: {
            ...layout.primary,
            bounds: { ...layout.primary.bounds, y: 30 },
          },
        }}
        onTransientHide={hide}
      />,
    );
    inputContent(
      screen.getByRole('textbox', { name: 'viewer text content' }),
      'name',
    );
    inputContent(
      screen.getByRole('textbox', { name: 'viewer secondary text' }),
      'role',
    );
    unmount();
    await act(async () => vi.runAllTimersAsync());
    expect(ops).not.toHaveBeenCalled();
    expect(hide.mock.calls).toEqual([
      ['t', true],
      ['t', false],
    ]);
    expect(editing.getState().draft).toBeNull();
    editing.dispose();
  });
  it('does not rewrite contenteditable DOM on its own preview echo or move the caret', async () => {
    const { editing, project } = await setupText();
    vi.useFakeTimers();
    render(
      <ViewerTextEditor
        editing={editing}
        clip={project.clips.t}
        active
        layout={layout}
        onTransientHide={vi.fn()}
      />,
    );
    const field = screen.getByRole('textbox');
    inputContent(field, 'abcdef');
    const range = document.createRange();
    if (!field.firstChild) throw new Error('expected text node');
    range.setStart(field.firstChild, 3);
    range.collapse(true);
    const selection = window.getSelection();
    if (!selection) throw new Error('expected selection');
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => vi.advanceTimersByTime(150));
    expect(selection.anchorOffset).toBe(3);
    expect(selection.anchorNode).toBe(field.firstChild);
    act(() => editing.dispose());
  });
  it('layout conversion never computes DOM text metrics at fit/100% scales', () => {
    expect(viewerRegionStyle(layout, 'primary')?.width).toBe(200);
    expect(
      viewerRegionStyle({ ...layout, displayScale: 1 }, 'primary')?.fontSize,
    ).toBe(56);
  });
});
describe('caption list and suggestions', () => {
  it('only time click seeks actual parent; caret clicks do not seek and active row follows parent player time', async () => {
    const { editing, project } = await setupText();
    project.clips.title = {
      ...project.clips.t,
      id: 'title',
      text: { style: 'title-bold', content: 'not a caption' },
    };
    editing.replaceSnapshot({ project, assets: [] });
    const seek = vi.fn();
    render(<CaptionsEditor editing={editing} playhead={1} onSeek={seek} />);
    expect(screen.queryByDisplayValue('not a caption')).toBeNull();
    const field = screen.getByRole('textbox', { name: 'caption at 00:00:00' });
    fireEvent.click(field);
    expect(seek).not.toHaveBeenCalled();
    const time = screen.getByRole('button', {
      name: 'seek to caption 00:00:00',
    });
    fireEvent.click(time);
    expect(seek).toHaveBeenCalledExactlyOnceWith(0);
    expect(time.closest('[data-active]')).toHaveAttribute(
      'data-active',
      'true',
    );
    act(() => editing.dispose());
  });
  it.each(['use it', 'keep mine'] as const)(
    'suggestion renders exact hint/actions and resolves core state: %s',
    async (choice) => {
      const { editing, project } = await setupText();
      render(<InspectorTextField editing={editing} clip={project.clips.t} />);
      const field = screen.getByRole('textbox');
      fireEvent.focus(field);
      fireEvent.change(field, { target: { value: 'my content' } });
      await act(async () =>
        editing.receiveAuthoritative({
          version: 1,
          author: 'agent',
          ops: [{ op: 'text.update', clipId: 't', content: 'suggested' }],
        }),
      );
      fireEvent.click(
        screen.getByRole('button', {
          name: 'kimo wants to change this too · see suggestion',
        }),
      );
      expect(
        screen.getByRole('region', { name: 'suggested text' }),
      ).toHaveTextContent('suggested');
      fireEvent.click(screen.getByRole('button', { name: choice }));
      expect(editing.getState().suggestions).toHaveLength(0);
      expect(field).toHaveValue(
        choice === 'use it' ? 'suggested' : 'my content',
      );
      expect(document.activeElement).toBe(field);
      act(() => editing.dispose());
    },
  );
});
