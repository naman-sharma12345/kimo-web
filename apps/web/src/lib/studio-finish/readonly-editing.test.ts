import * as React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEditingSession } from '@/lib/editing/session';
import { assets, fixture, memoryStorage } from '@/lib/editing/test-fixtures';
import { testPersistence } from '@/lib/editing/persistence-test-helpers';
import { createReadOnlyEditing } from './readonly-editing';

async function setup() {
  const live = createEditingSession({
    sessionId: 's',
    project: { ...fixture(), version: 9 },
    assets,
    storage: memoryStorage(),
    persistence: testPersistence().persistence,
    client: { ops: vi.fn(), session: vi.fn() },
  });
  await live.ready();
  const cut = fixture();
  const proxy = createReadOnlyEditing(live, cut, assets);
  return { live, proxy, cut };
}
describe('historical editing facade', () => {
  it('detaches and freezes preview while retaining a separate current live acknowledgement', async () => {
    const { live, proxy, cut } = await setup();
    expect(proxy.getState()).toMatchObject({
      project: { version: 0 },
      acknowledged: { version: 9 },
      acknowledgedVersion: 9,
      editingEnabled: false,
      dispatchEnabled: false,
      canUndo: false,
      canRedo: false,
      pending: [],
      draft: null,
      history: [],
      suggestions: [],
    });
    expect(proxy.getState().project).not.toBe(cut);
    expect(Object.isFrozen(proxy.getState().project.clips.c?.transform)).toBe(
      true,
    );
    expect(Object.isFrozen(proxy.getState().assets[0])).toBe(true);
    cut.clips.c.start = 99;
    expect(proxy.getState().project.clips.c?.start).toBe(0);
    const listener = vi.fn();
    const stop = proxy.subscribe(listener);
    await live.receiveAuthoritative({ version: 10, ops: [] });
    expect(listener).toHaveBeenCalled();
    expect(proxy.getState().acknowledgedVersion).toBe(10);
    expect(proxy.getState().project.version).toBe(0);
    expect(proxy.getState()).toBe(proxy.getState());
    stop();
    proxy.dispose();
    live.dispose();
    await live.closed();
  });
  it('blocks every mutation entry and never delegates lifecycle/flush authority to live', async () => {
    const { live, proxy } = await setup();
    const spies = Object.fromEntries(
      Object.keys(live).map((key) => [
        key,
        vi.spyOn(live, key as keyof typeof live),
      ]),
    );
    const begin = { clipIds: ['c'], source: 'viewer' as const, label: 'move' };
    for (const mutate of [
      () => proxy.beginEdit(begin),
      () => proxy.previewEdit('x', []),
      () => proxy.cancelEdit('x'),
      () => proxy.replaceSnapshot({ project: fixture(), assets }),
      () => proxy.resolveTextSuggestion('t', 'use it'),
    ])
      expect(mutate).toThrow('read-only');
    for (const operation of [
      proxy.commitEdit('x'),
      proxy.editGroup([], 'edit'),
      proxy.undoUser(),
      proxy.redoUser(),
      proxy.revertAgentGroup('a'),
    ])
      expect(await operation).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('read-only'),
      });
    await expect(
      proxy.receiveAuthoritative({ version: 10, ops: [] }),
    ).rejects.toThrow('read-only');
    await proxy.ready();
    await proxy.flush();
    const stop = proxy.subscribe(vi.fn());
    stop();
    proxy.dispose();
    proxy.dispose();
    await proxy.closed();
    for (const name of [
      'beginEdit',
      'previewEdit',
      'commitEdit',
      'cancelEdit',
      'editGroup',
      'undoUser',
      'redoUser',
      'revertAgentGroup',
      'receiveAuthoritative',
      'replaceSnapshot',
      'resolveTextSuggestion',
      'ready',
      'flush',
      'closed',
      'dispose',
    ]) {
      expect(spies[name], name).not.toHaveBeenCalled();
    }
    expect(live.getState().editingEnabled).toBe(true);
    expect(proxy.getState().persistenceStatus).toBe('disposed');
    live.dispose();
    await live.closed();
  });
  it('unsubscribes locally and does not publish live changes after disposal', async () => {
    const { live, proxy } = await setup();
    const listener = vi.fn();
    proxy.subscribe(listener);
    proxy.dispose();
    await live.receiveAuthoritative({ version: 10, ops: [] });
    expect(listener).not.toHaveBeenCalled();
    expect(proxy.getState().acknowledgedVersion).toBe(9);
    live.dispose();
    await live.closed();
  });
});

describe('read-only subscription ownership', () => {
  it('constructs without side effects and only retains committed subscriptions through StrictMode replay', async () => {
    const { live, proxy } = await setup();
    let active = 0;
    const original = live.subscribe;
    vi.spyOn(live, 'subscribe').mockImplementation((listener) => {
      active++;
      const stop = original(listener);
      return () => {
        active--;
        stop();
      };
    });
    createReadOnlyEditing(live, fixture(), assets);
    expect(active).toBe(0);
    function Consumer() {
      const view = React.useMemo(
        () => createReadOnlyEditing(live, fixture(), assets),
        [],
      );
      React.useEffect(() => view.subscribe(() => undefined), [view]);
      return null;
    }
    const result = render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(Consumer),
      ),
    );
    expect(active).toBe(1);
    result.unmount();
    expect(active).toBe(0);
    proxy.dispose();
    live.dispose();
    await live.closed();
  });
});
