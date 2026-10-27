import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTextEditModel } from './model';
import { setupText } from './test-helpers';
afterEach(() => vi.useRealTimers());
describe('single-authority shared text model', () => {
  it('shares pending value, previews at150ms without advancing authority and sends one group at800ms then blur once', async () => {
    const { editing, ops } = await setupText();
    vi.useFakeTimers();
    const model = getTextEditModel(editing, 't');
    const off = model.subscribe(() => undefined);
    expect(getTextEditModel(editing, 't')).toBe(model);
    model.change('content', 'one', 'inspector');
    model.change('content', 'one two', 'inspector');
    vi.advanceTimersByTime(149);
    expect(editing.getState().project.clips.t?.text?.content).toBe(
      'hello world',
    );
    vi.advanceTimersByTime(1);
    expect(editing.getState().project.clips.t?.text?.content).toBe('one two');
    expect(editing.getState().acknowledgedVersion).toBe(0);
    expect(ops).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(650);
    expect(ops).toHaveBeenCalledTimes(1);
    expect(ops.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ op: 'text.update', content: 'one two' }),
    ]);
    model.commit();
    await vi.runAllTimersAsync();
    expect(ops).toHaveBeenCalledTimes(1);
    off();
    editing.dispose();
  });
  it('focusout before debounce sends once and unmount cancels all pending callbacks', async () => {
    const { editing, ops } = await setupText();
    vi.useFakeTimers();
    const model = getTextEditModel(editing, 't');
    const off = model.subscribe(() => undefined);
    model.change('content', 'changed', 'viewer');
    model.commit();
    model.commit();
    await vi.runAllTimersAsync();
    expect(ops).toHaveBeenCalledTimes(1);
    model.change('content', 'aborted', 'viewer');
    off();
    await vi.runAllTimersAsync();
    expect(ops).toHaveBeenCalledTimes(1);
    expect(editing.getState().draft).toBeNull();
    editing.dispose();
  });
  it('IME pauses both timers until compositionend and secondary changes share one text.update', async () => {
    const { editing, ops } = await setupText();
    vi.useFakeTimers();
    const model = getTextEditModel(editing, 't');
    const off = model.subscribe(() => undefined);
    model.composition(true);
    model.change('content', '日本語', 'viewer');
    model.change('secondaryContent', 'speaker', 'viewer');
    await vi.advanceTimersByTimeAsync(2000);
    expect(ops).not.toHaveBeenCalled();
    model.commit();
    expect(ops).not.toHaveBeenCalled();
    model.composition(false);
    await vi.advanceTimersByTimeAsync(800);
    expect(ops).toHaveBeenCalledTimes(1);
    expect(ops.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({
        content: '日本語',
        secondaryContent: 'speaker',
      }),
    ]);
    off();
    editing.dispose();
  });
  it('accepts external updates when inactive; deletion cancels draft, timers and core selection/toast', async () => {
    const { editing, ops, toast, selectionRemoved } = await setupText();
    vi.useFakeTimers();
    const model = getTextEditModel(editing, 't');
    const off = model.subscribe(() => undefined);
    await editing.receiveAuthoritative({
      version: 1,
      author: 'agent',
      ops: [{ op: 'text.update', clipId: 't', content: 'external' }],
    });
    expect(model.getSnapshot().content).toBe('external');
    model.change('content', 'mine', 'inspector');
    await editing.receiveAuthoritative({
      version: 2,
      author: 'agent',
      ops: [{ op: 'clip.remove', id: 't' }],
    });
    expect(model.getSnapshot().removed).toBe(true);
    expect(selectionRemoved).toHaveBeenCalledWith(['t']);
    expect(toast).toHaveBeenCalledWith(
      'kimo removed a clip you were editing · undo',
      expect.anything(),
    );
    await vi.runAllTimersAsync();
    expect(ops).not.toHaveBeenCalled();
    off();
    editing.dispose();
  });
  it.each(['use it', 'keep mine'] as const)(
    'resolves queued suggestion explicitly: %s',
    async (choice) => {
      const { editing, ops } = await setupText();
      vi.useFakeTimers();
      const model = getTextEditModel(editing, 't');
      const off = model.subscribe(() => undefined);
      model.change('content', 'unflushed mine', 'inspector');
      await editing.receiveAuthoritative({
        version: 1,
        author: 'agent',
        ops: [{ op: 'text.update', clipId: 't', content: 'agent' }],
      });
      expect(model.getSnapshot().content).toBe('unflushed mine');
      expect(editing.getState().suggestions).toHaveLength(1);
      model.resolve(choice);
      expect(model.getSnapshot().content).toBe(
        choice === 'use it' ? 'agent' : 'unflushed mine',
      );
      model.commit();
      await vi.runAllTimersAsync();
      expect(ops).toHaveBeenCalledTimes(1);
      off();
      editing.dispose();
    },
  );
  it('disposal aborts scheduled edits and a distinct session cannot see prior draft', async () => {
    const first = await setupText();
    const second = await setupText();
    vi.useFakeTimers();
    const model = getTextEditModel(first.editing, 't');
    const off = model.subscribe(() => undefined);
    model.change('content', 'old', 'inspector');
    first.editing.dispose();
    await vi.runAllTimersAsync();
    expect(first.ops).not.toHaveBeenCalled();
    expect(getTextEditModel(second.editing, 't').getSnapshot().content).toBe(
      'hello world',
    );
    off();
    second.editing.dispose();
  });
});

describe('idle and collision races', () => {
  it('idle creates one logical group, retains softlock and later typing gets a second group, never keystroke groups', async () => {
    const { editing, ops } = await setupText();
    vi.useFakeTimers();
    const model = getTextEditModel(editing, 't');
    const off = model.subscribe(() => undefined);
    model.change('content', 'first', 'inspector');
    await vi.advanceTimersByTimeAsync(800);
    expect(ops).toHaveBeenCalledTimes(1);
    expect(editing.getState().draft?.clipIds).toEqual(['t']);
    model.change('content', 'second', 'inspector');
    model.change('content', 'second final', 'inspector');
    await vi.advanceTimersByTimeAsync(800);
    expect(ops).toHaveBeenCalledTimes(2);
    model.commit();
    await vi.runAllTimersAsync();
    expect(ops).toHaveBeenCalledTimes(2);
    off();
    editing.dispose();
  });
  it('unresolved AI collision cannot silently expire through the idle commit timer', async () => {
    const { editing, ops } = await setupText();
    vi.useFakeTimers();
    const model = getTextEditModel(editing, 't');
    const off = model.subscribe(() => undefined);
    model.change('content', 'mine', 'inspector');
    await editing.receiveAuthoritative({
      version: 1,
      author: 'agent',
      ops: [{ op: 'text.update', clipId: 't', content: 'agent' }],
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(ops).not.toHaveBeenCalled();
    expect(editing.getState().suggestions).toHaveLength(1);
    expect(model.getSnapshot().content).toBe('mine');
    model.resolve('keep mine');
    model.commit();
    await vi.runAllTimersAsync();
    expect(ops).toHaveBeenCalledOnce();
    off();
    editing.dispose();
  });
});
