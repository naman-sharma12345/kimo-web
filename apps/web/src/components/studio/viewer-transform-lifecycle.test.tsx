import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createEditingSession } from '@/lib/editing/session';
import { testPersistence } from '@/lib/editing/persistence-test-helpers';
import { fixture, assets } from '@/lib/editing/test-fixtures';
import { useViewerTransform } from './viewer-transform';
async function setup() {
  const project = fixture(),
    ops = vi.fn().mockResolvedValue({ version: 1 });
  const editing = createEditingSession({
    persistence: testPersistence().persistence,
    sessionId: 's',
    project,
    assets,
    client: { ops, session: vi.fn() },
    makeId: () => crypto.randomUUID(),
  });
  await editing.ready();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  svg.append(rect);
  document.body.append(svg);
  const start = {
    button: 0,
    pointerId: 7,
    clientX: 10,
    clientY: 20,
    currentTarget: rect,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.PointerEvent<SVGElement>;
  const hook = renderHook(() => useViewerTransform(editing, 0.5));
  const send = (type: string, x: number, y: number) => {
    const e = new Event(type);
    Object.defineProperties(e, {
      pointerId: { value: 7 },
      clientX: { value: x },
      clientY: { value: y },
    });
    window.dispatchEvent(e);
  };
  return {
    editing,
    ops,
    hook,
    start,
    send,
    close: () => {
      hook.unmount();
      editing.dispose();
      svg.remove();
    },
  };
}
it('coalesces local pointer previews and sends one final transform batch on release', async () => {
  const s = await setup();
  try {
    act(() => s.hook.result.current(s.start, 'c', 'move'));
    act(() => {
      s.send('pointermove', 20, 30);
      s.send('pointermove', 25, 40);
    });
    expect(s.ops).not.toHaveBeenCalled();
    act(() => s.send('pointerup', 30, 45));
    await waitFor(() => expect(s.ops).toHaveBeenCalledTimes(1));
    expect(s.ops.mock.calls[0]?.[1]).toEqual([
      {
        op: 'clip.update',
        id: 'c',
        patch: { transform: { ...fixture().clips.c.transform, x: 40, y: 50 } },
      },
    ]);
  } finally {
    s.close();
  }
});
it('cancels on pointer cancellation or unmount without dispatching a write', async () => {
  const s = await setup();
  try {
    act(() => s.hook.result.current(s.start, 'c', 'move'));
    act(() => {
      s.send('pointermove', 30, 40);
      s.send('pointercancel', 30, 40);
    });
    expect(s.editing.getState().draft).toBeNull();
    expect(s.ops).not.toHaveBeenCalled();
    act(() => s.hook.result.current(s.start, 'c', 'move'));
    act(() => s.send('pointermove', 30, 40));
    s.hook.unmount();
    expect(s.editing.getState().draft).toBeNull();
    expect(s.ops).not.toHaveBeenCalled();
  } finally {
    s.close();
  }
});
it('a simple selection click does not create a no-op HTTP batch', async () => {
  const s = await setup();
  try {
    act(() => s.hook.result.current(s.start, 'c', 'move'));
    act(() => s.send('pointerup', 10, 20));
    expect(s.ops).not.toHaveBeenCalled();
    expect(s.editing.getState().draft).toBeNull();
  } finally {
    s.close();
  }
});
