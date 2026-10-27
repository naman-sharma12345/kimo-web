import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectorTextField } from './inspector-text-field';
import { ViewerTextEditor } from './viewer-text-editor';
import { focusWithoutScroll } from './selection';
import { setupText } from './test-helpers';
import type { ViewerTextLayout } from './types';
const layout: ViewerTextLayout = {
  status: 'ready',
  sceneWidth: 1920,
  sceneHeight: 1080,
  displayScale: 1,
  letterbox: { x: 0, y: 0 },
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  primary: {
    bounds: { x: 0, y: 0, width: 200, height: 80 },
    style: {
      fontFamily: 'Geist',
      fontSize: 56,
      fontWeight: 500,
      fontStyle: 'normal',
      lineHeight: 60,
      letterSpacing: 0,
      color: 'white',
      textAlign: 'left',
    },
  },
};
afterEach(() => vi.useRealTimers());
describe('session and focus lifecycle', () => {
  it('E intent focus preserves ancestor scrollback and selects the full initial value', () => {
    const outer = document.createElement('div');
    const field = document.createElement('textarea');
    outer.append(field);
    document.body.append(outer);
    field.value = 'all text';
    outer.scrollTop = 240;
    outer.scrollLeft = 35;
    focusWithoutScroll(field, true);
    expect(outer.scrollTop).toBe(240);
    expect(outer.scrollLeft).toBe(35);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(8);
    outer.remove();
  });
  it('session prop replacement aborts old timers without leaking unsent text to the new session', async () => {
    const a = await setupText(),
      b = await setupText();
    vi.useFakeTimers();
    const { rerender, unmount } = render(
      <InspectorTextField editing={a.editing} clip={a.project.clips.t} />,
    );
    const field = screen.getByRole('textbox');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'old session' } });
    rerender(
      <InspectorTextField editing={b.editing} clip={b.project.clips.t} />,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'hello world',
    );
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(a.ops).not.toHaveBeenCalled();
    expect(b.ops).not.toHaveBeenCalled();
    expect(a.editing.getState().draft).toBeNull();
    unmount();
    a.editing.dispose();
    b.editing.dispose();
  });
  it('viewer AI deletion during composition cancels immediately, restores preview and calls core notifications', async () => {
    const { editing, project, ops, toast, selectionRemoved } =
      await setupText();
    vi.useFakeTimers();
    const hide = vi.fn(),
      finish = vi.fn();
    render(
      <ViewerTextEditor
        editing={editing}
        clip={project.clips.t}
        layout={layout}
        active
        onTransientHide={hide}
        onFinish={finish}
      />,
    );
    const field = screen.getByRole('textbox');
    fireEvent.compositionStart(field);
    field.textContent = 'uncommitted';
    fireEvent.input(field);
    await act(async () =>
      editing.receiveAuthoritative({
        version: 1,
        author: 'agent',
        ops: [{ op: 'clip.remove', id: 't' }],
      }),
    );
    expect(finish).toHaveBeenCalledExactlyOnceWith('removed');
    expect(hide.mock.calls).toEqual([
      ['t', true],
      ['t', false],
    ]);
    expect(selectionRemoved).toHaveBeenCalledWith(['t']);
    expect(toast).toHaveBeenCalledOnce();
    await act(async () => vi.runAllTimersAsync());
    expect(ops).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    editing.dispose();
  });
  it('commits lower-third primary and secondary as one text.update without separate history groups', async () => {
    const { editing, project, ops } = await setupText();
    vi.useFakeTimers();
    const secondary = {
      ...layout.primary,
      bounds: { ...layout.primary.bounds, y: 80 },
    };
    render(
      <ViewerTextEditor
        editing={editing}
        clip={project.clips.t}
        layout={{ ...layout, secondary }}
        active
        onTransientHide={vi.fn()}
      />,
    );
    const first = screen.getByRole('textbox', { name: 'viewer text content' }),
      second = screen.getByRole('textbox', { name: 'viewer secondary text' });
    first.textContent = 'speaker';
    fireEvent.input(first);
    fireEvent.blur(first, { relatedTarget: second });
    fireEvent.focus(second);
    second.textContent = 'engineer';
    fireEvent.input(second);
    fireEvent.pointerDown(document.body);
    await act(async () => vi.runAllTimersAsync());
    expect(ops).toHaveBeenCalledOnce();
    expect(ops.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({
        op: 'text.update',
        content: 'speaker',
        secondaryContent: 'engineer',
      }),
    ]);
    act(() => editing.dispose());
  });
  it('viewer focusout without a related target commits exactly once and restores parent focus', async () => {
    const { editing, project, ops } = await setupText();
    vi.useFakeTimers();
    const target = document.createElement('button');
    document.body.append(target);
    target.focus();
    const finish = vi.fn();
    render(
      <ViewerTextEditor
        editing={editing}
        clip={project.clips.t}
        layout={layout}
        active
        onTransientHide={vi.fn()}
        restoreFocusRef={{ current: target }}
        onFinish={finish}
      />,
    );
    const field = screen.getByRole('textbox');
    field.textContent = 'blurred';
    fireEvent.input(field);
    fireEvent.blur(field, { relatedTarget: null });
    fireEvent.pointerDown(document.body);
    await act(async () => vi.runAllTimersAsync());
    expect(ops).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(target);
    target.remove();
    act(() => editing.dispose());
  });
});

describe('StrictMode cleanup', () => {
  it('repeated setup/cleanup leaves no dirty timer or persisted edit after unmount', async () => {
    const { editing, project, ops } = await setupText();
    vi.useFakeTimers();
    const hide = vi.fn();
    const { unmount } = render(
      <React.StrictMode>
        <ViewerTextEditor
          editing={editing}
          clip={project.clips.t}
          layout={layout}
          active
          onTransientHide={hide}
        />
      </React.StrictMode>,
    );
    const field = screen.getByRole('textbox');
    field.textContent = 'aborted';
    fireEvent.input(field);
    unmount();
    await act(async () => vi.runAllTimersAsync());
    expect(ops).not.toHaveBeenCalled();
    expect(editing.getState().draft).toBeNull();
    expect(hide.mock.calls.filter((call) => call[1] === true).length).toBe(
      hide.mock.calls.filter((call) => call[1] === false).length,
    );
    editing.dispose();
  });
});
