import { describe, expect, it, vi } from 'vitest';
import { ApiError, applyOps, type KimoProject, type Op } from '@kimo/client';
import { planCutRestore } from '../studio-finish/cut-restore';
import { createEditingSession } from './session';
import { assets, deferred, fixture } from './test-fixtures';
import { testPersistence } from './persistence-test-helpers';
import {
  editIdentity,
  legacyOutboxSchema,
  validateOutbox,
} from './persistence';
import type { EditingAPI } from './types';
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function plan(session: EditingAPI, target = fixture()) {
  target.clips.c.in = 2;
  const result = planCutRestore(
    { ...session.getState(), sessionId: 's' },
    {
      id: 'cut',
      sessionId: 's',
      requestId: 'r',
      label: 'cut 1',
      ordinal: 1,
      createdAt: 0,
      project: target,
      assets,
    },
    assets,
  );
  if (!result.available) throw new Error(JSON.stringify(result.reasons));
  return result;
}
async function setup() {
  let server: KimoProject = fixture();
  const durable = testPersistence();
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
  const context = {
    sessionId: 's',
    project: fixture(),
    assets,
    client,
    persistence: durable.persistence,
  };
  const session = createEditingSession(context);
  await session.ready();
  return {
    session,
    client,
    durable,
    context,
    setServer: (p: KimoProject) => {
      server = p;
    },
  };
}
describe('persisted strict restore dispatch', () => {
  it('acknowledges once, with unknown durable before HTTP; exact undo/redo retain strict guards', async () => {
    const { session, client, durable } = await setup();
    const original = client.ops.getMockImplementation();
    if (!original) throw new Error('Missing mock implementation');
    client.ops.mockImplementation(async (...args) => {
      const stored = durable.writes.at(-1)?.groups[0];
      expect(stored?.status).toBe('unknown');
      expect(stored?.strictGuard).toBeDefined();
      expect(stored?.intentBaseline).toBeUndefined();
      return original(...args);
    });
    const reviewed = plan(session);
    expect(
      (
        await session.editGroup(
          reviewed.ops,
          'restore cut 1',
          'history',
          reviewed.options,
        )
      ).status,
    ).toBe('acknowledged');
    expect(session.getState().acknowledged.clips.c?.in).toBe(2);
    expect((await session.undoUser()).status).toBe('acknowledged');
    expect(session.getState().acknowledged.clips.c?.in).toBe(1);
    expect((await session.redoUser()).status).toBe('acknowledged');
    expect(session.getState().acknowledged.clips.c?.in).toBe(2);
    expect(client.ops).toHaveBeenCalledTimes(3);
  });
  it('rejects agent edits after review before enqueue without HTTP or mutation', async () => {
    const { session, client } = await setup();
    const reviewed = plan(session);
    await session.receiveAuthoritative({
      version: 1,
      author: 'agent',
      ops: [{ op: 'clip.remove', id: 'c' }],
    });
    await expect(
      session.editGroup(reviewed.ops, 'restore', 'history', reviewed.options),
    ).rejects.toThrow('stale');
    expect(client.ops).not.toHaveBeenCalled();
    expect(session.getState().project.clips.c).toBeUndefined();
  });
  it('fences updates during persisted unknown and does not send at the stale base', async () => {
    const { session, client, durable } = await setup();
    const reviewed = plan(session);
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    let saves = 0;
    durable.setBeforeSave(async () => {
      if (++saves === 2) {
        entered.resolve(undefined);
        await release.promise;
      }
    });
    const request = session.editGroup(
      reviewed.ops,
      'restore',
      'history',
      reviewed.options,
    );
    await entered.promise;
    const update = session.receiveAuthoritative({
      version: 1,
      author: 'agent',
      ops: [{ op: 'clip.update', id: 'c', patch: { locked: true, in: 3 } }],
    });
    await settle();
    release.resolve(undefined);
    await update;
    expect((await request).status).toBe('failed');
    expect(client.ops).not.toHaveBeenCalled();
    expect(session.getState().acknowledged.clips.c).toMatchObject({
      in: 3,
      locked: true,
    });
    expect(session.getState().pending).toHaveLength(0);
  });
  it('409 refresh invalidates review with exactly one HTTP attempt, no normal rebase/retry', async () => {
    const { session, client, setServer } = await setup();
    const reviewed = plan(session);
    const fresh = applyOps(fixture(), [
      { op: 'clip.update', id: 'c', patch: { in: 3 } },
    ]);
    setServer(fresh);
    const result = await session.editGroup(
      reviewed.ops,
      'restore',
      'history',
      reviewed.options,
    );
    expect(result).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('409'),
    });
    expect(client.ops).toHaveBeenCalledTimes(1);
    expect(client.session).toHaveBeenCalledTimes(1);
    expect(editIdentity(session.getState().acknowledged)).toBe(
      editIdentity(fresh),
    );
    await session.flush();
    expect(client.ops).toHaveBeenCalledTimes(1);
  });
  it('unknown delivery survives reload with guard intact and is never repeated', async () => {
    const { session, client, durable, context } = await setup();
    const reviewed = plan(session);
    client.ops.mockRejectedValue(new Error('connection lost after dispatch'));
    expect(
      (
        await session.editGroup(
          reviewed.ops,
          'restore',
          'history',
          reviewed.options,
        )
      ).status,
    ).toBe('unknown');
    const stored = durable.writes.at(-1);
    if (!stored) throw new Error('Missing stored record');
    expect(stored.groups[0]?.strictGuard).toEqual(reviewed.options.strictGuard);
    const migrated = {
      ...legacyOutboxSchema.parse({ ...stored, format: 1 }),
      format: 2,
    };
    expect(
      validateOutbox(migrated, { sessionId: 's', projectId: 'p' }).groups[0]
        ?.strictGuard,
    ).toEqual(reviewed.options.strictGuard);
    session.dispose();
    await session.closed();
    const recovered = createEditingSession(context);
    await recovered.ready();
    await recovered.flush();
    expect(recovered.getState().pending[0]?.status).toBe('unknown');
    expect(client.ops).toHaveBeenCalledTimes(1);
  });
  it('rejects stale recovered UNSENT restore rather than rebase or replay it', async () => {
    const { session, client, durable, context } = await setup();
    const reviewed = plan(session);
    session.dispose();
    await session.closed();
    durable.records.set(JSON.stringify({ sessionId: 's', projectId: 'p' }), {
      format: 2,
      sessionId: 's',
      projectId: 'p',
      baseVersion: 0,
      groups: [
        {
          id: 'stored',
          source: 'history',
          label: 'restore',
          ops: reviewed.ops,
          status: 'unsent',
          strictGuard: reviewed.options.strictGuard,
        },
      ],
    });
    const project = applyOps(fixture(), [{ op: 'clip.remove', id: 'c' }]);
    const recovered = createEditingSession({ ...context, project });
    await recovered.ready();
    await recovered.flush();
    expect(client.ops).not.toHaveBeenCalled();
    expect(recovered.getState().pending).toHaveLength(0);
    expect(recovered.getState().project.clips.c).toBeUndefined();
  });
  it('guards strict undo against intervening deletes, same-field edits, new clips and locks', async () => {
    for (const ops of [
      [{ op: 'clip.remove', id: 'c' }],
      [{ op: 'clip.update', id: 'c', patch: { in: 3 } }],
      [{ op: 'clip.update', id: 'c', patch: { locked: true } }],
      [{ op: 'clip.add', clip: { ...fixture().clips.c, id: 'new' } }],
    ] satisfies Op[][]) {
      const { session, client } = await setup();
      const reviewed = plan(session);
      await session.editGroup(
        reviewed.ops,
        'restore',
        'history',
        reviewed.options,
      );
      await session.receiveAuthoritative({ version: 2, author: 'agent', ops });
      expect((await session.undoUser()).status).toBe('failed');
      expect(client.ops).toHaveBeenCalledTimes(1);
    }
  });
  it('fences undo at dispatch after asynchronous durability, not merely at history generation', async () => {
    const { session, client, durable } = await setup();
    const reviewed = plan(session);
    await session.editGroup(
      reviewed.ops,
      'restore',
      'history',
      reviewed.options,
    );
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    let saves = 0;
    durable.setBeforeSave(async () => {
      if (++saves === 2) {
        entered.resolve(undefined);
        await release.promise;
      }
    });
    const undo = session.undoUser();
    await entered.promise;
    const update = session.receiveAuthoritative({
      version: 2,
      author: 'agent',
      ops: [{ op: 'clip.update', id: 'c', patch: { locked: true } }],
    });
    await settle();
    release.resolve(undefined);
    await update;
    expect((await undo).status).toBe('failed');
    expect(client.ops).toHaveBeenCalledTimes(1);
  });
  it('fails closed if storage fails before dispatch, and rejects guard/payload mismatch on recovery', async () => {
    const { session, client, durable } = await setup();
    const reviewed = plan(session);
    let saves = 0;
    durable.setBeforeSave(async () => {
      if (++saves === 2) throw new Error('quota');
    });
    expect(
      (
        await session.editGroup(
          reviewed.ops,
          'restore',
          'history',
          reviewed.options,
        )
      ).status,
    ).toBe('failed');
    expect(client.ops).not.toHaveBeenCalled();
    expect(session.getState().persistenceStatus).toBe('unavailable');
    const stored = durable.writes.at(-1);
    if (!stored) throw new Error('Missing stored record');
    const corrupted = structuredClone(stored);
    const corruptedGroup = corrupted.groups[0];
    if (!corruptedGroup) throw new Error('Missing stored group');
    corruptedGroup.ops = [{ op: 'clip.remove', id: 'c' }];
    expect(() =>
      validateOutbox(corrupted, { sessionId: 's', projectId: 'p' }),
    ).toThrow('strict guard');
  });
  it('fences asset identity changes even when project version stays unchanged', async () => {
    const { session, client, durable } = await setup();
    const reviewed = plan(session);
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    let saves = 0;
    durable.setBeforeSave(async () => {
      if (++saves === 2) {
        entered.resolve(undefined);
        await release.promise;
      }
    });
    const request = session.editGroup(
      reviewed.ops,
      'restore',
      'history',
      reviewed.options,
    );
    await entered.promise;
    session.replaceSnapshot({
      project: fixture(),
      assets: assets.map((a) => ({ ...a, url: '/changed.mp4' })),
    });
    release.resolve(undefined);
    expect((await request).status).toBe('failed');
    expect(client.ops).not.toHaveBeenCalled();
  });
  it('no-op creates neither persistence mutation nor history', async () => {
    const { session, client, durable } = await setup();
    const before = durable.writes.length;
    const result = await session.editGroup([], 'no-op', 'history');
    expect(result.status).toBe('cancelled');
    expect(client.ops).not.toHaveBeenCalled();
    expect(durable.writes).toHaveLength(before);
    expect(session.getState().history).toHaveLength(0);
  });
});
