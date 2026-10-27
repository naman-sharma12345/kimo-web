import * as React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditingAPI, EditState } from '@/lib/editing/types';
import type { TimelineEditorProps } from './types';
import { TimelineEditor } from './timeline';
import { clip, project, source, track } from './test-fixtures';
const paint = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  roundRect: vi.fn(),
  clip: vi.fn(),
  fillText: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  drawImage: vi.fn(),
};
function setup(overrides: Partial<TimelineEditorProps> = {}) {
  const p = overrides.project ?? project();
  const result = { id: 'edit', status: 'acknowledged' as const };
  const editing: EditingAPI = {
    getState: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    beginEdit: vi.fn(() => 'gesture'),
    previewEdit: vi.fn(),
    commitEdit: vi.fn(async () => result),
    cancelEdit: vi.fn(),
    editGroup: vi.fn(async () => result),
    undoUser: vi.fn(async () => result),
    redoUser: vi.fn(async () => result),
    revertAgentGroup: vi.fn(async () => result),
    receiveAuthoritative: vi.fn(async () => undefined),
    replaceSnapshot: vi.fn(),
    resolveTextSuggestion: vi.fn(),
    flush: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
  const editState: EditState = {
    project: p,
    acknowledged: p,
    acknowledgedVersion: 1,
    assets: [source],
    pending: [],
    draft: null,
    saveStatus: 'saved',
    storageAvailable: true,
    canUndo: false,
    canRedo: false,
    history: [],
    suggestions: [],
  };
  const props: TimelineEditorProps = {
    project: p,
    assets: [source],
    editing,
    editState,
    selection: ['a'],
    setSelection: vi.fn(),
    playhead: 5,
    onSeek: vi.fn(),
    onScrubStart: vi.fn(),
    onScrub: vi.fn(),
    onScrubEnd: vi.fn(),
    zoom: 100,
    tool: 'select',
    snapping: true,
    linked: true,
    onOpenText: vi.fn(),
    onInspect: vi.fn(),
    onMessage: vi.fn(),
    onReplace: vi.fn(),
    onUpload: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  const view = render(<TimelineEditor {...props} />);
  return { ...view, props, editing };
}
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => paint) as unknown as typeof HTMLCanvasElement.prototype.getContext,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
});
describe('timeline editor source-level lifecycle with mocked canvas', () => {
  it('renders one canvas per visible row plus one ruler and bounds backing stores at extreme duration', () => {
    const p = project(
      [clip('a', { duration: 36000 })],
      [track('audio', 'audio'), track('v'), track('text', 'text')],
    );
    const view = setup({ project: p, zoom: 600 });
    expect(view.container.querySelectorAll('canvas')).toHaveLength(4);
    for (const node of view.container.querySelectorAll('canvas'))
      expect(node.width).toBeLessThanOrEqual(3840);
    expect(
      view.container.querySelectorAll('[data-track-id]')[0],
    ).toHaveAttribute('data-track-id', 'text');
    expect(p.tracks[0]?.id).toBe('audio');
  });
  it('provides named roving proxies and moves focus without global seeking', () => {
    const { props } = setup({
      project: project([clip(), clip('b', { start: 8 })]),
    });
    const first = screen.getByRole('button', {
      name: 'beach_02, video, starts 00:04, 3 seconds',
    });
    const second = screen.getByRole('button', {
      name: 'beach_02, video, starts 00:08, 3 seconds',
    });
    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('tabindex', '-1');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(second).toHaveFocus();
    expect(props.onSeek).not.toHaveBeenCalled();
  });
  it('scopes nudge/delete/lock keys to timeline and preserves text caret', () => {
    const { editing, container } = setup();
    const root = screen.getByRole('grid', { name: 'timeline editor' });
    fireEvent.keyDown(root, { key: '.', shiftKey: true });
    expect(editing.editGroup).toHaveBeenLastCalledWith(
      [{ op: 'clip.move', id: 'a', trackId: 'v', start: 4 + 10 / 30 }],
      'nudge clips',
      'timeline',
    );
    const input = document.createElement('input');
    container.appendChild(input);
    fireEvent.keyDown(input, { key: 'Delete' });
    expect(editing.editGroup).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(root, { key: 'l' });
    expect(editing.editGroup).toHaveBeenLastCalledWith(
      [{ op: 'clip.update', id: 'a', patch: { locked: true } }],
      'lock clips',
      'timeline',
    );
  });
  it('opens the exact context menu in spec order and prefills without sending', async () => {
    const { props } = setup();
    const proxy = screen.getByRole('button', {
      name: /beach_02, video, starts/,
    });
    fireEvent.contextMenu(proxy, { clientX: 300, clientY: 40 });
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((node) => node.textContent),
    ).toEqual([
      'split at playhead',
      'duplicate',
      'delete',
      'speed…',
      'detach audio',
      'replace media…',
      'ask kimo about this clip',
      'lock',
    ]);
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'ask kimo about this clip' }),
    );
    expect(props.onMessage).toHaveBeenCalledWith('@beach_02 ');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
  it('creates caption-clean text at playhead and opens the actual text surface', async () => {
    const { editing, props } = setup();
    await act(async () =>
      fireEvent.keyDown(screen.getByRole('grid'), { key: 't', ctrlKey: true }),
    );
    expect(editing.editGroup).toHaveBeenCalledTimes(1);
    const call = vi.mocked(editing.editGroup).mock.calls[0];
    expect(call?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: 'clip.add',
          clip: expect.objectContaining({
            start: 5,
            duration: 3,
            text: { content: 'your text', style: 'caption-clean' },
          }),
        }),
      ]),
    );
    expect(props.onOpenText).toHaveBeenCalledTimes(1);
  });
  it('shows only audio mute controls and existing upload callback/attribution', () => {
    const { props } = setup({
      assetsOpen: true,
      project: project([], [track('v'), track('music', 'audio')]),
      assets: [
        {
          ...source,
          source: 'web',
          attribution: {
            site: 'archive.org',
            pageUrl: 'https://archive.org',
            license: 'CC0',
          },
        },
      ],
    });
    expect(
      screen.queryByRole('button', { name: 'mute V1' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'mute audio' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'found by kimo' }));
    expect(
      screen.getByRole('button', { name: 'add beach_02 at playhead' }),
    ).toHaveAttribute('title', 'found on archive.org · CC0');
    const file = new File(['media'], 'user.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('upload more'), {
      target: { files: [file] },
    });
    expect(props.onUpload).toHaveBeenCalledWith([file]);
  });
  it('uses scrubbing lifecycle once and cancels an active gesture on unmount', async () => {
    const { props, editing, unmount } = setup();
    const ruler = screen.getByRole('slider', { name: 'timeline scrubber' });
    fireEvent.pointerDown(ruler, { button: 0, clientX: 100 });
    fireEvent.pointerUp(ruler);
    expect(props.onScrubStart).toHaveBeenCalledTimes(1);
    expect(props.onScrubEnd).toHaveBeenCalledTimes(1);
    const surface = document.querySelector('[data-track-surface="v"]');
    if (!surface) throw new Error('Missing track');
    fireEvent.pointerDown(surface, { button: 0, clientX: 660, clientY: 50 });
    expect(editing.beginEdit).toHaveBeenCalledTimes(1);
    unmount();
    expect(editing.cancelEdit).toHaveBeenCalledTimes(1);
    expect(editing.commitEdit).not.toHaveBeenCalled();
  });
  it('previews pointer movement locally and commits only one batch on release', async () => {
    const { editing, container } = setup({ snapping: false });
    const root = screen.getByRole('grid');
    const surface = container.querySelector('[data-track-surface="v"]');
    if (!surface) throw new Error('Missing track');
    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 8,
      clientX: 660,
      clientY: 40,
    });
    fireEvent.pointerMove(root, { pointerId: 8, clientX: 680, clientY: 40 });
    fireEvent.pointerMove(root, { pointerId: 8, clientX: 760, clientY: 40 });
    expect(editing.commitEdit).not.toHaveBeenCalled();
    expect(editing.editGroup).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.pointerUp(root, { pointerId: 8, clientX: 760, clientY: 40 }),
    );
    expect(editing.commitEdit).toHaveBeenCalledTimes(1);
    expect(editing.commitEdit).toHaveBeenCalledWith('gesture', [
      { op: 'clip.move', id: 'a', trackId: 'v', start: 5 },
    ]);
    fireEvent.lostPointerCapture(root, { pointerId: 8 });
    expect(editing.commitEdit).toHaveBeenCalledTimes(1);
  });
  it('keeps Alt duplicate IDs stable over many previews and commits one copy', async () => {
    const { editing, container } = setup({ snapping: false });
    const root = screen.getByRole('grid');
    const surface = container.querySelector('[data-track-surface="v"]');
    if (!surface) throw new Error('Missing track');
    fireEvent.pointerDown(surface, {
      button: 0,
      altKey: true,
      pointerId: 9,
      clientX: 660,
      clientY: 40,
    });
    fireEvent.pointerMove(root, { pointerId: 9, clientX: 760, clientY: 40 });
    fireEvent.pointerMove(root, { pointerId: 9, clientX: 860, clientY: 40 });
    await act(async () =>
      fireEvent.pointerUp(root, { pointerId: 9, clientX: 860, clientY: 40 }),
    );
    const ops = vi.mocked(editing.commitEdit).mock.calls[0]?.[1];
    expect(ops).toHaveLength(2);
    const add = ops?.[0];
    expect(add?.op).toBe('clip.add');
    if (add?.op !== 'clip.add') throw new Error('Missing copy');
    expect(add.clip.id).not.toBe('a');
    expect(ops?.[1]).toEqual({
      op: 'clip.move',
      id: add.clip.id,
      trackId: 'v',
      start: 6,
    });
  });
  it('uses modifier ripple trim and source-aware slip through the same command helpers', async () => {
    const { editing, container, rerender, props } = setup({
      snapping: false,
      project: project([clip(), clip('later', { start: 7 })]),
    });
    const root = screen.getByRole('grid');
    const surface = container.querySelector('[data-track-surface="v"]');
    if (!surface) throw new Error('Missing track');
    fireEvent.pointerDown(surface, {
      button: 0,
      ctrlKey: true,
      pointerId: 2,
      clientX: 859,
      clientY: 40,
    });
    fireEvent.pointerMove(root, { pointerId: 2, clientX: 959, clientY: 40 });
    await act(async () =>
      fireEvent.pointerUp(root, { pointerId: 2, clientX: 959, clientY: 40 }),
    );
    expect(editing.commitEdit).toHaveBeenLastCalledWith('gesture', [
      { op: 'clip.trim', id: 'a', edge: 'out', value: 6 },
      { op: 'clip.move', id: 'later', trackId: 'v', start: 8 },
    ]);
    rerender(<TimelineEditor {...props} tool="slip" />);
    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 3,
      clientX: 660,
      clientY: 40,
    });
    fireEvent.pointerMove(root, { pointerId: 3, clientX: 760, clientY: 40 });
    await act(async () =>
      fireEvent.pointerUp(root, { pointerId: 3, clientX: 760, clientY: 40 }),
    );
    expect(editing.commitEdit).toHaveBeenLastCalledWith('gesture', [
      { op: 'clip.update', id: 'a', patch: { in: 3 } },
    ]);
  });
  it('rolls back on Escape, pointercancel and lost capture without committing', () => {
    const { editing, container } = setup();
    const root = screen.getByRole('grid');
    const surface = container.querySelector('[data-track-surface="v"]');
    if (!surface) throw new Error('Missing track');
    for (const kind of ['Escape', 'cancel', 'lost']) {
      fireEvent.pointerDown(surface, {
        button: 0,
        pointerId: 4,
        clientX: 660,
        clientY: 40,
      });
      fireEvent.pointerMove(root, { pointerId: 4, clientX: 700, clientY: 40 });
      if (kind === 'Escape') fireEvent.keyDown(root, { key: 'Escape' });
      else if (kind === 'cancel')
        fireEvent.pointerCancel(root, { pointerId: 4 });
      else fireEvent.lostPointerCapture(root, { pointerId: 4 });
    }
    expect(editing.cancelEdit).toHaveBeenCalledTimes(3);
    expect(editing.commitEdit).not.toHaveBeenCalled();
  });
  it('rejects locked clip gestures and supports keyboard trim handles', () => {
    const { editing } = setup();
    fireEvent.keyDown(
      screen.getByRole('slider', { name: 'trim out beach_02' }),
      { key: 'ArrowLeft' },
    );
    expect(editing.editGroup).toHaveBeenCalledWith(
      [{ op: 'clip.trim', id: 'a', edge: 'out', value: 5 - 1 / 30 }],
      'trim clip',
      'timeline',
    );
  });
  it('preserves existing selection on context menu and supports marquee addition', () => {
    const { props, container } = setup({
      project: project([clip(), clip('b', { start: 8 })]),
      selection: ['a', 'b'],
    });
    fireEvent.contextMenu(screen.getByRole('button', { name: /starts 00:04/ }));
    expect(props.setSelection).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    const root = screen.getByRole('grid');
    const surface = container.querySelector('[data-track-surface="v"]');
    if (!surface) throw new Error('Missing track');
    fireEvent.pointerDown(surface, {
      button: 0,
      shiftKey: true,
      pointerId: 5,
      clientX: 300,
      clientY: 5,
    });
    fireEvent.pointerMove(root, { pointerId: 5, clientX: 800, clientY: 60 });
    expect(props.setSelection).toHaveBeenLastCalledWith(['a', 'b']);
    fireEvent.pointerUp(root, { pointerId: 5, clientX: 800, clientY: 60 });
  });
  it('does not change track kind during a drag and blocks locked targets', async () => {
    const { editing, container } = setup({
      snapping: false,
      project: project([clip()], [track(), track('audio', 'audio')]),
    });
    const root = screen.getByRole('grid');
    const surface = container.querySelector('[data-track-surface="v"]');
    if (!surface) throw new Error('Missing track');
    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 6,
      clientX: 660,
      clientY: 40,
    });
    await act(async () =>
      fireEvent.pointerUp(root, { pointerId: 6, clientX: 760, clientY: 110 }),
    );
    expect(editing.commitEdit).toHaveBeenCalledWith('gesture', [
      { op: 'clip.move', id: 'a', trackId: 'v', start: 5 },
    ]);
  });
  it('cleans up playhead scrub on lost capture and reports current time on ruler', () => {
    const { props } = setup();
    expect(
      screen.getByRole('slider', { name: 'timeline scrubber' }),
    ).toHaveAttribute('aria-valuenow', '5');
    const head = screen.getByRole('button', { name: 'playhead 00:05' });
    fireEvent.pointerDown(head, { button: 0, pointerId: 7 });
    fireEvent.lostPointerCapture(head, { pointerId: 7 });
    fireEvent.pointerCancel(head, { pointerId: 7 });
    expect(props.onScrubEnd).toHaveBeenCalledTimes(1);
  });
  it('shows frame ticks only at the exact 300px/s threshold', () => {
    const { rerender, props } = setup({ zoom: 299 });
    paint.moveTo.mockClear();
    rerender(<TimelineEditor {...props} zoom={299.5} />);
    expect(
      paint.moveTo.mock.calls.some((args: unknown[]) => args[1] === 26),
    ).toBe(false);
    paint.moveTo.mockClear();
    rerender(<TimelineEditor {...props} zoom={300} />);
    expect(
      paint.moveTo.mock.calls.some((args: unknown[]) => args[1] === 26),
    ).toBe(true);
  });
  it('will not begin editing locked clips or locked tracks', () => {
    const { editing, container } = setup({
      project: project([clip('a', { locked: true })]),
    });
    const surface = container.querySelector('[data-track-surface="v"]');
    if (!surface) throw new Error('Missing track');
    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 1,
      clientX: 660,
      clientY: 40,
    });
    expect(editing.beginEdit).not.toHaveBeenCalled();
    expect(editing.commitEdit).not.toHaveBeenCalled();
  });
  it('mounts an injected inline text surface without a second text transaction owner', () => {
    const text = clip('text', {
      kind: 'text',
      trackId: 'text-track',
      assetId: undefined,
      text: { content: 'live text', style: 'caption-clean' },
    });
    const Inline = ({ onClose }: { onClose: () => void }) => (
      <input
        aria-label="inline text"
        defaultValue="live text"
        onBlur={onClose}
      />
    );
    const { container, editing } = setup({
      project: project([text], [track('text-track', 'text')]),
      selection: ['text'],
      InlineTextEditor: Inline,
    });
    const label = screen.getByRole('button', { name: 'live text' });
    fireEvent.doubleClick(label);
    const input = screen.getByRole('textbox', { name: 'inline text' });
    fireEvent.pointerDown(input, {
      button: 0,
      pointerId: 1,
      clientX: 660,
      clientY: 20,
    });
    expect(editing.beginEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(editing.editGroup).not.toHaveBeenCalled();
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
  });
  it('adds a real registered asset at the drop time through the shared editing API', () => {
    const { editing, container } = setup({ assetsOpen: true });
    const surface = container.querySelector('[data-track-surface="v"]');
    if (!surface) throw new Error('Missing track');
    const drop = new MouseEvent('drop', {
      bubbles: true,
      clientX: 760,
      clientY: 40,
    });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        getData: (type: string) =>
          type === 'application/x-kimo-asset' ? 'source' : '',
      },
    });
    fireEvent(surface, drop);
    expect(editing.editGroup).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          op: 'clip.add',
          clip: expect.objectContaining({
            assetId: 'source',
            kind: 'video',
            trackId: 'v',
            start: 6,
            duration: 30,
            in: 0,
            speed: 1,
          }),
        }),
      ],
      'add asset',
      'timeline',
    );
  });
});
