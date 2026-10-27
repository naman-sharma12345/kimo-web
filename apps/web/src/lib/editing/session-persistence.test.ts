import { describe, expect, it, vi } from 'vitest';
import { ApiError, applyOps, type Op } from '@kimo/client';
import { createEditingSession } from './session';
import { assets, deferred, fixture } from './test-fixtures';
import { testPersistence } from './persistence-test-helpers';
import type { EditContext } from './types';
const move: Op[] = [{ op: 'clip.move', id: 'c', trackId: 'v', start: 2 }];
async function setup(
  options: Partial<EditContext> = {},
  storage = testPersistence(),
) {
  let server = fixture();
  const client: EditContext['client'] = {
    ops: vi.fn(async (_id, ops, version) => {
      server = applyOps(server, ops, version + 1) as ReturnType<typeof fixture>;
      return { version: server.version };
    }),
    session: vi.fn(async () => ({
      status: 'editing' as const,
      project: server,
      assets,
    })),
  };
  const session = createEditingSession({
    sessionId: 's',
    project: fixture(),
    assets,
    client,
    persistence: storage.persistence,
    ...options,
  });
  await session.ready();
  return { session, client, storage };
}
const tick = async () => {
  for (let n = 0; n < 20; n++) await Promise.resolve();
};
describe('asynchronous durable EditingSession', () => {
  it('exposes hydration, gates synchronous drafts and waits for an in-process predecessor', async () => {
    const barrier = deferred<undefined>();
    const { persistence } = testPersistence();
    const open = vi.spyOn(persistence, 'open');
    const client = { ops: vi.fn(), session: vi.fn() };
    const session = createEditingSession({
      sessionId: 's',
      project: fixture(),
      client,
      persistence,
      persistenceReadyAfter: barrier.promise,
    });
    expect(session.getState()).toMatchObject({
      saveStatus: 'pending',
      persistenceStatus: 'hydrating',
      editingEnabled: false,
    });
    expect(() =>
      session.beginEdit({ clipIds: ['c'], label: 'move', source: 'timeline' }),
    ).toThrow('loading');
    await tick();
    expect(open).not.toHaveBeenCalled();
    barrier.resolve(undefined);
    await session.ready();
    expect(session.getState().dispatchEnabled).toBe(true);
    session.dispose();
    await session.closed();
  });
  it('waits for committed unsent AND unknown writes before HTTP', async () => {
    const { session, client, storage } = await setup();
    const first = deferred<undefined>();
    const second = deferred<undefined>();
    let count = 0;
    storage.setBeforeSave(() =>
      ++count === 1 ? first.promise : second.promise,
    );
    const result = session.editGroup(move, 'move');
    await tick();
    expect(client.ops).not.toHaveBeenCalled();
    first.resolve(undefined);
    await tick();
    expect(storage.writes[0]?.groups[0]?.status).toBe('unsent');
    expect(client.ops).not.toHaveBeenCalled();
    storage.setBeforeSave();
    second.resolve(undefined);
    await result;
    expect(storage.writes[1]?.groups[0]).toMatchObject({
      status: 'unknown',
      baseVersion: 0,
      ops: move,
    });
    expect(client.ops).toHaveBeenCalledTimes(1);
    expect(session.getState().saveStatus).toBe('saved');
  });
  it('never dispatches failed storage or absent production persistence', async () => {
    const a = await setup();
    a.storage.setBeforeSave(async () => {
      throw new Error('quota');
    });
    expect((await a.session.editGroup(move, 'move')).status).toBe('failed');
    expect(a.client.ops).not.toHaveBeenCalled();
    expect(a.session.getState()).toMatchObject({
      saveStatus: 'unsaved',
      storageAvailable: false,
    });
    const b = await setup({ persistence: undefined });
    await b.session.editGroup(move, 'move');
    await b.session.flush();
    expect(b.client.ops).not.toHaveBeenCalled();
    expect(b.session.getState().saveStatus).toBe('unsaved');
  });
  it('retains unknown across close/reload and blocks following intent', async () => {
    const storage = testPersistence();
    const a = await setup({}, storage);
    vi.mocked(a.client.ops).mockRejectedValueOnce(
      new TypeError('response lost'),
    );
    expect(
      (
        await a.session.editGroup(
          [{ op: 'clip.split', id: 'c', at: 2, newId: 'right' }],
          'split',
        )
      ).status,
    ).toBe('unknown');
    a.session.dispose();
    await a.session.closed();
    const b = await setup({}, storage);
    await b.session.editGroup(move, 'later');
    await b.session.flush();
    expect(b.client.ops).not.toHaveBeenCalled();
    expect(b.session.getState().saveStatus).toBe('unknown');
  });
  it('saves a new unknown candidate before a 409 retry and blocks a failed retry save', async () => {
    const { session, client, storage } = await setup();
    vi.mocked(client.ops).mockImplementationOnce(async () => {
      storage.setBeforeSave(async () => {
        throw new Error('quota on retry');
      });
      throw new ApiError(409, 'stale');
    });
    await session.editGroup(move, 'move');
    expect(client.ops).toHaveBeenCalledTimes(1);
    expect(session.getState().saveStatus).toBe('unsaved');
  });
  it('keeps acknowledged result but unsaved status when durable ACK cleanup fails', async () => {
    const { session, client, storage } = await setup();
    vi.mocked(client.ops).mockImplementationOnce(async () => {
      storage.setBeforeSave(async () => {
        throw new Error('quota after acceptance');
      });
      return { version: 1 };
    });
    expect((await session.editGroup(move, 'move')).status).toBe('acknowledged');
    expect(session.getState()).toMatchObject({
      pending: [],
      saveStatus: 'unsaved',
      dispatchEnabled: false,
    });
  });
  it('preserves ordering of rapid groups and immutable save snapshots', async () => {
    const { session, client, storage } = await setup();
    const first = session.editGroup(move, 'first');
    const second = session.editGroup(
      [{ op: 'text.update', clipId: 't', content: 'mine' }],
      'second',
    );
    await Promise.all([first, second]);
    expect(vi.mocked(client.ops).mock.calls.map((call) => call[2])).toEqual([
      0, 1,
    ]);
    expect(storage.writes[0]?.groups.map((g) => g.label)).toEqual(['first']);
    expect(storage.writes[1]?.groups.map((g) => g.label)).toEqual([
      'first',
      'second',
    ]);
    expect(storage.writes.at(-1)?.groups).toEqual([]);
  });
  it('blocks a true secondary owner but permits an explicit closed predecessor barrier', async () => {
    const storage = testPersistence();
    const a = await setup({}, storage);
    const b = await setup({}, storage);
    expect(b.session.getState()).toMatchObject({
      persistenceStatus: 'locked',
      editingEnabled: false,
    });
    await expect(b.session.editGroup(move, 'blocked')).rejects.toThrow(
      'another tab',
    );
    a.session.dispose();
    const c = await setup(
      { persistenceReadyAfter: a.session.closed() },
      storage,
    );
    expect(c.session.getState().persistenceStatus).toBe('ready');
  });
  it('authoritative snapshot refresh cannot turn a locked secondary tab into a local editor', async () => {
    const storage = testPersistence();
    const first = await setup({}, storage);
    const second = await setup({}, storage);
    second.session.replaceSnapshot({
      project: { ...fixture(), version: 1 },
      assets,
    });
    await tick();
    expect(second.session.getState()).toMatchObject({
      persistenceStatus: 'locked',
      editingEnabled: false,
      dispatchEnabled: false,
    });
    expect(() =>
      second.session.beginEdit({
        clipIds: ['c'],
        source: 'timeline',
        label: 'blocked',
      }),
    ).toThrow('another tab');
    expect(second.client.ops).not.toHaveBeenCalled();
    first.session.dispose();
    await first.session.closed();
  });
  it('persists exact rebased retry payload/base before the second request', async () => {
    const { session, client, storage } = await setup();
    vi.mocked(client.ops).mockRejectedValueOnce(new ApiError(409, 'stale'));
    vi.mocked(client.session).mockResolvedValueOnce({
      status: 'editing',
      project: { ...fixture(), version: 1 },
      assets,
    });
    vi.mocked(client.ops).mockImplementationOnce(async (_id, ops, version) => {
      expect(version).toBe(1);
      expect(storage.writes.at(-1)?.groups[0]).toMatchObject({
        status: 'unknown',
        baseVersion: 1,
        ops,
      });
      return { version: 2 };
    });
    expect((await session.editGroup(move, 'move')).status).toBe('acknowledged');
    expect(vi.mocked(client.ops).mock.calls.map((call) => call[2])).toEqual([
      0, 1,
    ]);
  });
  it('settles identified authority while HTTP is unresolved without a parallel send chain', async () => {
    const { session, client, storage } = await setup({
      mutationIdentity: true,
    });
    const ack = deferred<{ version: number }>();
    vi.mocked(client.ops).mockImplementationOnce(() => ack.promise);
    const result = session.editGroup(move, 'move');
    await tick();
    const mutationId = vi.mocked(client.ops).mock.calls[0]?.[3]
      ?.clientMutationId;
    expect(mutationId).toBeDefined();
    await session.receiveAuthoritative({
      version: 1,
      author: 'user',
      clientMutationId: mutationId,
      ops: move,
    });
    expect(storage.writes.at(-1)?.groups).toEqual([]);
    ack.reject(new TypeError('response lost'));
    expect((await result).status).toBe('acknowledged');
    expect(session.getState().history).toHaveLength(1);
  });
  it('reprepares after authority advances while the unknown marker is being committed', async () => {
    const { session, client, storage } = await setup();
    const gate = deferred<undefined>();
    let saves = 0;
    storage.setBeforeSave(() =>
      ++saves === 2 ? gate.promise : Promise.resolve(),
    );
    const result = session.editGroup(move, 'move');
    await tick();
    expect(client.ops).not.toHaveBeenCalled();
    session.replaceSnapshot({ project: { ...fixture(), version: 1 }, assets });
    gate.resolve(undefined);
    await result;
    expect(vi.mocked(client.ops).mock.calls[0]?.[2]).toBe(1);
    const candidates = storage.writes.filter(
      (record) => record.groups[0]?.status === 'unknown',
    );
    expect(
      candidates.some((record) => record.groups[0]?.baseVersion === 1),
    ).toBe(true);
  });
  it('identified authority can settle during preparation without a network invocation', async () => {
    const { session, client, storage } = await setup({
      mutationIdentity: true,
    });
    const gate = deferred<undefined>();
    let saves = 0;
    storage.setBeforeSave(() =>
      ++saves === 2 ? gate.promise : Promise.resolve(),
    );
    const result = session.editGroup(move, 'move');
    await tick();
    const id = session.getState().pending[0]?.id;
    const receiving = session.receiveAuthoritative({
      version: 1,
      author: 'user',
      clientMutationId: id,
      ops: move,
    });
    await tick();
    gate.resolve(undefined);
    await receiving;
    expect((await result).status).toBe('acknowledged');
    expect(client.ops).not.toHaveBeenCalled();
    expect(storage.writes.at(-1)?.groups).toEqual([]);
  });
  it('disposal during preparation cannot invoke HTTP or mutate a new owner', async () => {
    const { session, client, storage } = await setup();
    const saved = deferred<undefined>();
    storage.setBeforeSave(() => saved.promise);
    const result = session.editGroup(move, 'move');
    await tick();
    session.dispose();
    saved.resolve(undefined);
    await result;
    await session.closed();
    expect(client.ops).not.toHaveBeenCalled();
    expect(session.getState().saveStatus).toBe('disposed');
  });
});
