import { testPersistence } from './persistence-test-helpers';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, applyOps, type KimoProject, type Op } from '@kimo/client';
import { createEditingSession } from './session';
import { assets, deferred, fixture, memoryStorage } from './test-fixtures';
import type { EditContext } from './types';
async function setup(overrides: Partial<EditContext> = {}) {
  let server: KimoProject = fixture();
  const client = {
    ops: vi.fn(async (_id: string, ops: Op[], version: number) => {
      if (version !== server.version) throw new ApiError(409, 'conflict');
      server = applyOps(server, ops);
      return { version: server.version };
    }),
    session: vi.fn(async () => ({
      status: 'editing' as const,
      project: server,
      assets,
    })),
  };
  const context: EditContext = {
    sessionId: 's',
    project: fixture(),
    assets,
    storage: memoryStorage(),
    client,
    ...overrides,
  };
  context.persistence = persistenceFor(context.storage);
  const session = createEditingSession(context);
  await session.ready();
  return {
    client,
    context,
    session,
    setServer(project: KimoProject) {
      server = project;
    },
  };
}
const move = (start: number): Op[] => [
  { op: 'clip.move', id: 'c', trackId: 'v', start },
];
const rename = (content: string): Op[] => [
  { op: 'text.update', clipId: 't', content },
];
describe('editing transactions and authority', () => {
  it('replaces previews against begin baseline, never posts or advances version, commits exactly once', async () => {
    const { session, client } = await setup();
    const id = session.beginEdit({
      clipIds: ['c'],
      label: 'move',
      source: 'timeline',
    });
    for (let frame = 1; frame < 50; frame++)
      session.previewEdit(id, move(frame / 30));
    session.previewEdit(id, move(2));
    session.previewEdit(id, move(1));
    expect(client.ops).not.toHaveBeenCalled();
    expect(session.getState().project.clips.c?.start).toBe(1);
    expect(session.getState().acknowledgedVersion).toBe(0);
    expect(session.getState().project.version).toBe(0);
    const first = session.commitEdit(id);
    expect(session.commitEdit(id)).toBe(first);
    expect((await first).status).toBe('acknowledged');
    expect(client.ops).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({
      acknowledgedVersion: 1,
      saveStatus: 'saved',
      canUndo: true,
    });
  });
  it('cancels a draft without HTTP and reveals queued authoritative fields immediately on release', async () => {
    const { session } = await setup();
    const id = session.beginEdit({
      clipIds: ['c'],
      label: 'move',
      source: 'timeline',
    });
    session.previewEdit(id, move(2));
    await session.receiveAuthoritative({
      version: 1,
      actionId: 'real-action',
      ops: [
        { op: 'clip.update', id: 'c', patch: { volume: 0.5 } },
        { op: 'text.update', clipId: 't', content: 'agent title' },
      ],
    });
    expect(session.getState().acknowledgedVersion).toBe(1);
    expect(session.getState().project.clips.c?.volume).toBeUndefined();
    expect(session.getState().project.clips.t?.text?.content).toBe(
      'agent title',
    );
    session.cancelEdit(id);
    expect(session.getState().project.clips.c?.volume).toBe(0.5);
  });
  it('serializes overlapping user groups using latest acknowledged bases, not optimistic increments', async () => {
    const { session, client } = await setup();
    const firstAck = deferred<{ version: number }>();
    client.ops
      .mockImplementationOnce(() => firstAck.promise)
      .mockResolvedValueOnce({ version: 2 });
    const first = session.editGroup(move(1), 'move');
    const second = session.editGroup(rename('mine'), 'title text');
    await settleDispatch();
    expect(client.ops).toHaveBeenCalledTimes(1);
    expect(session.getState().acknowledgedVersion).toBe(0);
    firstAck.resolve({ version: 1 });
    await first;
    await second;
    expect(client.ops.mock.calls.map((call) => call[2])).toEqual([0, 1]);
    expect(session.getState().acknowledgedVersion).toBe(2);
  });
  it('handles own WebSocket echo before HTTP ACK without duplicating non-idempotent track adds', async () => {
    const { session, client } = await setup();
    const ack = deferred<{ version: number }>();
    client.ops.mockImplementationOnce(() => ack.promise);
    const ops: Op[] = [
      {
        op: 'track.add',
        track: {
          id: 'new',
          kind: 'audio',
          name: 'new audio',
          height: 64,
          muted: false,
          hidden: false,
          locked: false,
        },
      },
    ];
    const result = session.editGroup(ops, 'audio');
    await settleDispatch();
    await session.receiveAuthoritative({ version: 1, ops });
    expect(
      session.getState().project.tracks.filter((t) => t.id === 'new'),
    ).toHaveLength(1);
    ack.resolve({ version: 1 });
    expect((await result).status).toBe('acknowledged');
    await session.receiveAuthoritative({ version: 1, ops });
    expect(
      session.getState().project.tracks.filter((t) => t.id === 'new'),
    ).toHaveLength(1);
  });
  it('deduplicates HTTP-before-echo and keeps later agent operations', async () => {
    const { session } = await setup();
    await session.editGroup(move(1), 'move');
    await session.receiveAuthoritative({ version: 1, ops: move(1) });
    await session.receiveAuthoritative({
      version: 2,
      actionId: 'agent-2',
      ops: rename('agent'),
    });
    await session.receiveAuthoritative({ version: 1, ops: move(99) });
    expect(session.getState().acknowledgedVersion).toBe(2);
    expect(session.getState().project.clips.t?.text?.content).toBe('agent');
    expect(session.getState().project.clips.c?.start).toBe(1);
  });
  it('advances authority during a text lock and exposes the exact suggestion without changing the active draft', async () => {
    const { session } = await setup();
    const id = session.beginEdit({
      clipIds: ['t'],
      label: 'title text',
      source: 'viewer',
    });
    session.previewEdit(id, rename('mine'));
    await session.receiveAuthoritative({
      version: 1,
      actionId: 'title-action',
      ops: rename('theirs'),
    });
    expect(session.getState().acknowledged.clips.t?.text?.content).toBe(
      'theirs',
    );
    expect(session.getState().project.clips.t?.text?.content).toBe('mine');
    expect(session.getState().suggestions[0]).toMatchObject({
      clipId: 't',
      content: 'theirs',
      version: 1,
    });
    session.resolveTextSuggestion('t', 'use it');
    expect(session.getState().project.clips.t?.text?.content).toBe('theirs');
    session.cancelEdit(id);
  });
  it('immediately cancels removed draft, cleans selection and supplies a deliberate exact-toast undo action', async () => {
    const toast = vi.fn();
    const selectionRemoved = vi.fn();
    const { session, setServer } = await setup({
      notifications: { toast },
      selectionRemoved,
    });
    const id = session.beginEdit({
      clipIds: ['c'],
      label: 'move',
      source: 'timeline',
    });
    session.previewEdit(id, move(1));
    const ops: Op[] = [{ op: 'clip.remove', id: 'c' }];
    setServer(applyOps(fixture(), ops));
    await session.receiveAuthoritative({
      version: 1,
      actionId: 'removed',
      ops,
    });
    expect(session.getState().draft).toBeNull();
    expect(session.getState().project.clips.c).toBeUndefined();
    expect(selectionRemoved).toHaveBeenCalledWith(['c']);
    expect(toast).toHaveBeenCalledWith(
      'kimo removed a clip you were editing · undo',
      expect.objectContaining({ label: 'undo' }),
    );
    expect((await session.commitEdit(id)).status).toBe('cancelled');
    const action: { label: string; run(): void } | undefined =
      toast.mock.calls[0]?.[1];
    action?.run();
    await session.flush();
    expect(session.getState().project.clips.c).toBeDefined();
  });
  it('rebases and retries only once on evidenced 409, restoring snapshot assets as well', async () => {
    const assetsChanged = vi.fn();
    const { session, client, setServer } = await setup({ assetsChanged });
    setServer(applyOps(fixture(), rename('agent')));
    client.ops.mockRejectedValueOnce(new ApiError(409, 'stale'));
    expect((await session.editGroup(move(2), 'move')).status).toBe(
      'acknowledged',
    );
    expect(client.ops.mock.calls.map((call) => call[2])).toEqual([0, 1]);
    expect(client.session).toHaveBeenCalledTimes(1);
    expect(assetsChanged).toHaveBeenCalledWith(assets);
    expect(session.getState().project.clips.t?.text?.content).toBe('agent');
  });
  it('revalidates after 409 and does not retry a removed/locked target', async () => {
    const { session, client, setServer } = await setup();
    setServer(applyOps(fixture(), [{ op: 'clip.remove', id: 'c' }]));
    client.ops.mockRejectedValueOnce(new ApiError(409, 'stale'));
    expect((await session.editGroup(move(2), 'move')).status).toBe('failed');
    expect(client.ops).toHaveBeenCalledTimes(1);
    expect(session.getState().saveStatus).toBe('unsaved');
  });
  it('never retries a second 409 or loses the pending edit on failed snapshot', async () => {
    const a = await setup();
    a.client.ops.mockRejectedValue(new ApiError(409, 'stale'));
    expect((await a.session.editGroup(move(1), 'move')).status).toBe('failed');
    expect(a.client.ops).toHaveBeenCalledTimes(2);
    expect(a.session.getState().pending).toHaveLength(1);
    const b = await setup();
    b.client.ops.mockRejectedValue(new ApiError(409, 'stale'));
    b.client.session.mockRejectedValue(new Error('offline snapshot'));
    expect((await b.session.editGroup(move(1), 'move')).status).toBe('failed');
    expect(b.session.getState().project.clips.c?.start).toBe(1);
    expect(b.session.getState().pending).toHaveLength(1);
  });
  it('treats timeout acceptance as unknown and never replays add/split on flush or reload', async () => {
    const storage = memoryStorage();
    const a = await setup({ storage });
    a.client.ops.mockRejectedValue(new TypeError('timeout'));
    const result = await a.session.editGroup(
      [{ op: 'clip.split', id: 'c', at: 2, newId: 'right' }],
      'split',
    );
    expect(result.status).toBe('unknown');
    expect(a.session.getState().saveStatus).toBe('unknown');
    expect(a.session.getState().project.clips.right).toBeDefined();
    await a.session.flush();
    expect(a.client.ops).toHaveBeenCalledTimes(1);
    a.session.dispose();
    await a.session.closed();
    const b = await setup({ storage });
    await b.session.flush();
    expect(b.client.ops).not.toHaveBeenCalled();
    expect(b.session.getState().saveStatus).toBe('unknown');
  });
  it('restores an unsent session-versioned offline outbox, but not into another project or session', async () => {
    const storage = memoryStorage();
    const a = await setup({ storage, online: () => false });
    expect((await a.session.editGroup(move(2), 'move')).status).toBe('queued');
    a.session.dispose();
    await a.session.closed();
    expect(a.client.ops).not.toHaveBeenCalled();
    const b = await setup({ storage });
    expect(b.session.getState().pending).toHaveLength(1);
    await b.session.flush();
    expect(b.client.ops).toHaveBeenCalledTimes(1);
    expect(b.session.getState().saveStatus).toBe('saved');
    const other = await setup({ sessionId: 'other', storage });
    expect(other.session.getState().pending).toHaveLength(0);
  });
  it('reports denied storage as unsaved and never calls it locally saved', async () => {
    const denied = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const { session } = await setup({ storage: denied, online: () => false });
    await session.editGroup(move(1), 'move');
    expect(session.getState()).toMatchObject({
      storageAvailable: false,
      saveStatus: 'unsaved',
    });
  });
  it('buffers a version gap and does not roll back a newer authority when the snapshot is behind', async () => {
    const { session, client } = await setup();
    await session.receiveAuthoritative({
      version: 1,
      actionId: 'a1',
      ops: rename('one'),
    });
    client.session.mockResolvedValue({
      status: 'editing',
      project: fixture(),
      assets,
    });
    await session.receiveAuthoritative({
      version: 3,
      actionId: 'a3',
      ops: rename('three'),
    });
    expect(session.getState().acknowledgedVersion).toBe(1);
    await session.receiveAuthoritative({
      version: 2,
      actionId: 'a2',
      ops: move(2),
    });
    expect(session.getState().acknowledgedVersion).toBe(3);
    expect(session.getState().project.clips.t?.text?.content).toBe('three');
  });
  it('invalidates stale HTTP work and aborts its request when a session is disposed', async () => {
    const projectChanged = vi.fn();
    const { session, client } = await setup({ projectChanged });
    const ack = deferred<{ version: number }>();
    client.ops.mockImplementationOnce(() => ack.promise);
    const result = session.editGroup(move(2), 'move');
    await settleDispatch();
    session.dispose();
    const calls = projectChanged.mock.calls.length;
    ack.resolve({ version: 1 });
    expect((await result).status).toBe('cancelled');
    expect(projectChanged).toHaveBeenCalledTimes(calls);
    expect(session.getState().saveStatus).toBe('disposed');
    expect(() =>
      session.beginEdit({ clipIds: ['c'], label: 'move', source: 'timeline' }),
    ).toThrow('disposed');
  });
});
describe('per-author conditional undo and real action IDs', () => {
  it('undoes a user field while preserving unrelated later AI fields, then supports redo', async () => {
    const { session, setServer } = await setup();
    await session.editGroup(move(1), 'move');
    const ai: Op[] = [{ op: 'clip.update', id: 'c', patch: { volume: 0.4 } }];
    setServer(applyOps(session.getState().acknowledged, ai));
    await session.receiveAuthoritative({
      version: 2,
      actionId: 'real-action',
      ops: ai,
    });
    expect((await session.undoUser()).status).toBe('acknowledged');
    expect(session.getState().project.clips.c).toMatchObject({
      start: 0,
      volume: 0.4,
    });
    expect((await session.redoUser()).status).toBe('acknowledged');
    expect(session.getState().project.clips.c).toMatchObject({
      start: 1,
      volume: 0.4,
    });
  });
  it('refuses same-field collisions rather than erasing the agent, with no HTTP dispatch', async () => {
    const { session, client } = await setup();
    await session.editGroup(move(1), 'move');
    await session.receiveAuthoritative({
      version: 2,
      actionId: 'agent',
      ops: move(2),
    });
    expect((await session.undoUser()).status).toBe('failed');
    expect(client.ops).toHaveBeenCalledTimes(1);
    expect(session.getState().project.clips.c?.start).toBe(2);
  });
  it('keeps redo after an agent update, but clears it for a new user group', async () => {
    const { session, setServer } = await setup();
    await session.editGroup(move(1), 'move');
    await session.undoUser();
    expect(session.getState().canRedo).toBe(true);
    const ai = rename('AI title');
    setServer(applyOps(session.getState().acknowledged, ai));
    await session.receiveAuthoritative({
      version: 3,
      actionId: 'agent',
      ops: ai,
    });
    expect(session.getState().canRedo).toBe(true);
    await session.editGroup(move(2), 'new move');
    expect(session.getState().canRedo).toBe(false);
  });
  it('reverts a real agent group only with locally observed preimages, preserving later unrelated user edits', async () => {
    const { session, setServer } = await setup();
    const ai = rename('agent title');
    setServer(applyOps(fixture(), ai));
    await session.receiveAuthoritative({
      version: 1,
      actionId: 'actual-action-id',
      ops: ai,
    });
    await session.editGroup(move(2), 'move');
    expect((await session.revertAgentGroup('actual-action-id')).status).toBe(
      'acknowledged',
    );
    expect(session.getState().project.clips.t?.text?.content).toBe(
      'hello world',
    );
    expect(session.getState().project.clips.c?.start).toBe(2);
    expect(
      (await session.revertAgentGroup('fabricated-after-reload')).status,
    ).toBe('failed');
  });
  it('preserves unrelated nested transform leaves when undoing a numeric edit', async () => {
    const { session, setServer } = await setup();
    const c = fixture().clips.c;
    await session.editGroup(
      [
        {
          op: 'clip.update',
          id: 'c',
          patch: { transform: { ...c.transform, x: 10 } },
        },
      ],
      'position x',
    );
    const ai: Op[] = [
      {
        op: 'clip.update',
        id: 'c',
        patch: { transform: { ...c.transform, x: 10, rotation: 45 } },
      },
    ];
    setServer(applyOps(session.getState().acknowledged, ai));
    await session.receiveAuthoritative({
      version: 2,
      actionId: 'rotate',
      ops: ai,
    });
    expect((await session.undoUser()).status).toBe('acknowledged');
    expect(session.getState().project.clips.c?.transform).toMatchObject({
      x: 0,
      rotation: 45,
    });
  });
});

const persistenceByStorage = new WeakMap<
  object,
  ReturnType<typeof testPersistence>
>();
function persistenceFor(storage?: EditContext['storage']) {
  if (!storage) return testPersistence().persistence;
  let adapter = persistenceByStorage.get(storage);
  if (!adapter) {
    adapter = testPersistence();
    persistenceByStorage.set(storage, adapter);
  }
  return adapter.persistence;
}
async function settleDispatch() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
