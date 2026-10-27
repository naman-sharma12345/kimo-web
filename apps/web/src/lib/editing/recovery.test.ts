import { describe, expect, it, vi } from 'vitest';
import { ApiError, applyOps, type KimoProject, type Op } from '@kimo/client';
import { createEditingSession } from './session';
import { detachAudio, trimClip } from './commands';
import { captureHistory, historyOps } from './history';
import { assets, deferred, fixture, memoryStorage } from './test-fixtures';
import type { EditContext } from './types';
function harness(options: Partial<EditContext> = {}) {
  let server: KimoProject = fixture();
  const client = {
    ops: vi.fn<EditContext['client']['ops']>(async (_id, ops, version) => {
      if (version !== server.version) throw new ApiError(409, 'stale');
      server = applyOps(server, ops);
      return { version: server.version };
    }),
    session: vi.fn<EditContext['client']['session']>(async () => ({
      status: 'editing',
      project: server,
      assets,
    })),
  };
  const session = createEditingSession({
    sessionId: 's',
    project: server,
    assets,
    storage: memoryStorage(),
    client,
    ...options,
  });
  return {
    session,
    client,
    setServer(p: KimoProject) {
      server = p;
    },
  };
}
const move: Op[] = [{ op: 'clip.move', id: 'c', trackId: 'v', start: 2 }];
describe('recovery and concurrent authority regressions', () => {
  it('preserves an unrelated agent field arriving while the user POST is in flight', async () => {
    const { session, client } = harness();
    const ack = deferred<{ version: number }>();
    client.ops.mockImplementationOnce(() => ack.promise);
    const result = session.editGroup(move, 'move');
    await Promise.resolve();
    await session.receiveAuthoritative({
      version: 1,
      actionId: 'agent',
      ops: [{ op: 'clip.update', id: 'c', patch: { volume: 0.3 } }],
    });
    expect(session.getState().project.clips.c).toMatchObject({
      start: 2,
      volume: 0.3,
    });
    ack.resolve({ version: 2 });
    await result;
    expect(session.getState().project.clips.c).toMatchObject({
      start: 2,
      volume: 0.3,
    });
    expect(session.getState().acknowledgedVersion).toBe(2);
  });
  it('commits over advanced authority after a soft lock, without dropping the agent field', async () => {
    const { session, setServer } = harness();
    const id = session.beginEdit({
      clipIds: ['c'],
      label: 'move',
      source: 'timeline',
    });
    session.previewEdit(id, move);
    const ai: Op[] = [{ op: 'clip.update', id: 'c', patch: { volume: 0.4 } }];
    setServer(applyOps(fixture(), ai));
    await session.receiveAuthoritative({ version: 1, actionId: 'ai', ops: ai });
    expect((await session.commitEdit(id)).status).toBe('acknowledged');
    expect(session.getState().project.clips.c).toMatchObject({
      start: 2,
      volume: 0.4,
    });
  });
  it('resolves an unknown request only when an explicit own mutation ID proves acceptance, never matching op contents', async () => {
    const { session, client } = harness({ mutationIdentity: true });
    client.ops.mockRejectedValueOnce(new TypeError('response lost'));
    const result = await session.editGroup(move, 'move');
    const mutationId = client.ops.mock.calls[0]?.[3]?.clientMutationId;
    expect(result.status).toBe('unknown');
    expect(mutationId).toBeDefined();
    await session.receiveAuthoritative({
      version: 1,
      author: 'user',
      clientMutationId: mutationId,
      ops: move,
    });
    expect(session.getState()).toMatchObject({
      saveStatus: 'saved',
      pending: [],
      canUndo: true,
      acknowledgedVersion: 1,
    });
    expect(session.getState().history).toHaveLength(1);
    await session.flush();
    expect(client.ops).toHaveBeenCalledTimes(1);
  });
  it('does not duplicate user history when identified WS acceptance arrives before a lost HTTP response', async () => {
    const { session, client } = harness({ mutationIdentity: true });
    const ack = deferred<{ version: number }>();
    client.ops.mockImplementationOnce(() => ack.promise);
    const result = session.editGroup(move, 'move');
    await Promise.resolve();
    const mutationId = client.ops.mock.calls[0]?.[3]?.clientMutationId;
    await session.receiveAuthoritative({
      version: 1,
      author: 'user',
      clientMutationId: mutationId,
      ops: move,
    });
    ack.reject(new TypeError('lost response'));
    expect((await result).status).toBe('acknowledged');
    expect(session.getState().history).toHaveLength(1);
    expect(session.getState().pending).toHaveLength(0);
  });
  it('reconciles a high ACK by fetching authority, but exposes missing preimages rather than fake undo', async () => {
    const { session, client, setServer } = harness();
    const ai: Op[] = [{ op: 'text.update', clipId: 't', content: 'AI' }];
    const newer = applyOps(applyOps(fixture(), ai), move);
    setServer(newer);
    client.ops.mockResolvedValueOnce({ version: 2 });
    expect((await session.editGroup(move, 'move')).status).toBe('acknowledged');
    expect(session.getState().project.clips.t?.text?.content).toBe('AI');
    expect(session.getState().history[0]?.available).toBe(false);
    expect(session.getState().canUndo).toBe(false);
  });
  it('cancels a removed active clip when recovery arrives as a snapshot instead of an op', () => {
    const selectionRemoved = vi.fn();
    const toast = vi.fn();
    const { session } = harness({ selectionRemoved, notifications: { toast } });
    session.beginEdit({ clipIds: ['c'], label: 'move', source: 'timeline' });
    session.replaceSnapshot({
      project: applyOps(fixture(), [{ op: 'clip.remove', id: 'c' }]),
      assets,
    });
    expect(session.getState().draft).toBeNull();
    expect(selectionRemoved).toHaveBeenCalledWith(['c']);
    expect(toast.mock.calls[0]?.[0]).toBe(
      'kimo removed a clip you were editing · undo',
    );
  });
  it('keeps mine explicitly even when no keystroke preceded the collision; use it updates words too', () => {
    const { session } = harness();
    const id = session.beginEdit({
      clipIds: ['t'],
      label: 'title text',
      source: 'viewer',
    });
    return session
      .receiveAuthoritative({
        version: 1,
        actionId: 'ai',
        ops: [
          { op: 'text.update', clipId: 't', content: 'AI suggestion has four' },
        ],
      })
      .then(() => {
        session.resolveTextSuggestion('t', 'keep mine');
        expect(session.getState().draft?.ops[0]).toMatchObject({
          op: 'text.update',
          content: 'hello world',
        });
        session.cancelEdit(id);
        const next = session.beginEdit({
          clipIds: ['t'],
          label: 'title text',
          source: 'viewer',
        });
        return session
          .receiveAuthoritative({
            version: 2,
            actionId: 'ai2',
            ops: [{ op: 'text.update', clipId: 't', content: 'new words now' }],
          })
          .then(() => {
            session.resolveTextSuggestion('t', 'use it');
            expect(
              session
                .getState()
                .project.clips.t?.text?.words?.map((word) => word.w),
            ).toEqual(['new', 'words', 'now']);
            session.cancelEdit(next);
          });
      });
  });
  it('does not call an invalid/nonadvancing HTTP acknowledgement saved', async () => {
    const { session, client } = harness();
    client.ops.mockResolvedValueOnce({ version: 0 });
    expect((await session.editGroup(move, 'move')).status).toBe('unknown');
    expect(session.getState().pending).toHaveLength(1);
    expect(session.getState().saveStatus).toBe('unknown');
  });
  it('leaves a malformed stored outbox intact and unsaved, without replaying a partial prefix', async () => {
    const storage = memoryStorage();
    const key = 'kimo:editing:1:s:p';
    const raw = '{not valid json';
    storage.setItem(key, raw);
    const { session, client } = harness({ storage });
    expect(session.getState().saveStatus).toBe('unsaved');
    await session.flush();
    session.dispose();
    expect(storage.getItem(key)).toBe(raw);
    expect(client.ops).not.toHaveBeenCalled();
  });
  it('aborts read and write signals and prevents disposed snapshot callbacks from leaking', async () => {
    const { session, client } = harness();
    const snapshot =
      deferred<Awaited<ReturnType<EditContext['client']['session']>>>();
    client.session.mockImplementationOnce(() => snapshot.promise);
    const receiving = session.receiveAuthoritative({ version: 3, ops: [] });
    const signal = client.session.mock.calls[0]?.[1]?.signal;
    session.dispose();
    expect(signal?.aborted).toBe(true);
    snapshot.resolve({
      status: 'editing',
      project: { ...fixture(), version: 3 },
      assets,
    });
    await receiving;
    expect(session.getState().acknowledgedVersion).toBe(0);
  });
  it('isolates a failing integration callback from an acknowledged server write', async () => {
    const { session } = harness({
      projectChanged: () => {
        throw new Error('broken UI subscriber');
      },
      activity: () => {
        throw new Error('broken activity subscriber');
      },
    });
    expect((await session.editGroup(move, 'move')).status).toBe('acknowledged');
    expect(session.getState().pending).toHaveLength(0);
    expect(session.getState().acknowledgedVersion).toBe(1);
  });
});
describe('field inverse precision and atomic command recovery', () => {
  it('undoes ordered effect changes while preserving an unrelated later AI parameter and effect', () => {
    const p = fixture();
    p.clips.c.effects = [
      { id: 'a', kind: 'blur', params: { radius: 1 } },
      { id: 'b', kind: 'grain', params: { amount: 0.2 } },
    ];
    const ops: Op[] = [
      {
        op: 'effect.set',
        clipId: 'c',
        effect: { id: 'a', kind: 'blur', params: { radius: 2 } },
      },
    ];
    const history = captureHistory(p, ops, {
      id: 'u',
      label: 'blur',
      author: 'user',
    });
    const after = applyOps(p, ops);
    const ai: Op[] = [
      {
        op: 'effect.set',
        clipId: 'c',
        effect: { id: 'b', kind: 'grain', params: { amount: 0.4 } },
      },
      {
        op: 'effect.set',
        clipId: 'c',
        effect: { id: 'extra', kind: 'sharpen', params: { amount: 1 } },
      },
    ];
    // Keep relative user-established order, but change a different effect's parameter.
    const current = applyOps(after, [
      {
        op: 'clip.update',
        id: 'c',
        patch: {
          effects: [
            { id: 'b', kind: 'grain', params: { amount: 0.4 } },
            { id: 'a', kind: 'blur', params: { radius: 2 } },
            { id: 'extra', kind: 'sharpen', params: { amount: 1 } },
          ],
        },
      },
    ]);
    expect(ai).toHaveLength(2);
    const reverted = applyOps(current, historyOps(current, history, 'undo'));
    expect(reverted.clips.c?.effects).toEqual([
      { id: 'a', kind: 'blur', params: { radius: 1 } },
      { id: 'b', kind: 'grain', params: { amount: 0.4 } },
      { id: 'extra', kind: 'sharpen', params: { amount: 1 } },
    ]);
  });
  it('undoes detach including a newly-created empty track and preserves unrelated later AI properties', () => {
    const p = fixture();
    p.tracks = p.tracks.filter((track) => track.kind !== 'audio');
    p.clips.c.keyframes = [
      { property: 'volume', time: 0, value: 0.7 },
      { property: 'x', time: 0, value: 1 },
    ];
    let n = 0;
    const ops = detachAudio(p, 'c', () => `fresh${++n}`);
    const history = captureHistory(p, ops, {
      id: 'u',
      label: 'detach',
      author: 'user',
    });
    const after = applyOps(p, ops);
    const current = applyOps(after, [
      {
        op: 'clip.update',
        id: 'c',
        patch: { transform: { ...p.clips.c.transform, rotation: 45 } },
      },
    ]);
    const audio = Object.values(after.clips).find(
      (clip) => clip.kind === 'audio',
    );
    expect(audio?.keyframes).toEqual([
      { property: 'volume', time: 0, value: 0.7 },
    ]);
    expect(after.clips.c?.keyframes).toEqual([
      { property: 'x', time: 0, value: 1 },
    ]);
    const reverted = applyOps(current, historyOps(current, history, 'undo'));
    expect(reverted.clips.c).toMatchObject({
      transform: { rotation: 45 },
      keyframes: p.clips.c.keyframes,
    });
    expect(reverted.clips.c?.linkGroupId).toBeUndefined();
    expect(reverted.tracks).toEqual(p.tracks);
    expect(
      Object.values(reverted.clips).some((clip) => clip.kind === 'audio'),
    ).toBe(false);
  });
  it('extends ripple-in from source headroom even when the timeline clip starts at zero', () => {
    const p = fixture();
    const next = applyOps(
      p,
      trimClip(p, 'c', 'in', 0, { ripple: true, assets }),
    );
    expect(next.clips.c).toMatchObject({ start: 0, in: 0, duration: 5 });
  });
});

describe('optional-field undo defaults and action boundaries', () => {
  it('undoes and redoes a newly-set clip lock without trying to remove a locked clip', async () => {
    const { session } = harness();
    await session.editGroup(
      [{ op: 'clip.update', id: 'c', patch: { locked: true } }],
      'lock',
    );
    expect(session.getState().project.clips.c?.locked).toBe(true);
    expect((await session.undoUser()).status).toBe('acknowledged');
    expect(session.getState().project.clips.c?.locked).toBe(false);
    expect((await session.redoUser()).status).toBe('acknowledged');
    expect(session.getState().project.clips.c?.locked).toBe(true);
  });
  it('restores an absent solo flag to its explicit false default', async () => {
    const { session } = harness();
    await session.editGroup(
      [{ op: 'track.update', id: 'aud', patch: { solo: true } }],
      'solo',
    );
    expect((await session.undoUser()).status).toBe('acknowledged');
    expect(
      session.getState().project.tracks.find((track) => track.id === 'aud')
        ?.solo,
    ).toBe(false);
  });
  it('reverts repeated streamed writes with the same actual action ID to the first preimage', async () => {
    const { session, setServer } = harness();
    const a: Op[] = [{ op: 'text.update', clipId: 't', content: 'one' }];
    const b: Op[] = [{ op: 'text.update', clipId: 't', content: 'two' }];
    const first = applyOps(fixture(), a);
    const second = applyOps(first, b);
    setServer(second);
    await session.receiveAuthoritative({
      version: 1,
      actionId: 'same-action',
      ops: a,
    });
    await session.receiveAuthoritative({
      version: 2,
      actionId: 'same-action',
      ops: b,
    });
    expect(
      session
        .getState()
        .history.filter((entry) => entry.actionId === 'same-action'),
    ).toHaveLength(1);
    expect((await session.revertAgentGroup('same-action')).status).toBe(
      'acknowledged',
    );
    expect(session.getState().project.clips.t?.text?.content).toBe(
      'hello world',
    );
  });
  it('undoes same-count text words without overwriting unrelated later timing changes', () => {
    const p = fixture();
    const text = p.clips.t.text;
    if (!text) throw new Error('Fixture text missing');
    const ops: Op[] = [
      {
        op: 'text.update',
        clipId: 't',
        content: 'good morning',
        words: [
          { w: 'good', t: 0, d: 1 },
          { w: 'morning', t: 1, d: 3 },
        ],
      },
    ];
    const entry = captureHistory(p, ops, {
      id: 'u',
      label: 'text',
      author: 'user',
    });
    const current = applyOps(applyOps(p, ops), [
      {
        op: 'text.update',
        clipId: 't',
        content: 'good morning',
        words: [
          { w: 'good', t: 0.2, d: 0.8 },
          { w: 'morning', t: 1.2, d: 2.8 },
        ],
      },
    ]);
    const next = applyOps(current, historyOps(current, entry, 'undo'));
    expect(next.clips.t?.text?.words).toEqual([
      { w: 'hello', t: 0.2, d: 0.8 },
      { w: 'world', t: 1.2, d: 2.8 },
    ]);
  });
});

describe('nested intent rebasing rather than stale full-object replacement', () => {
  it('merges a drag/numeric transform draft with queued AI rotation at release', async () => {
    const { session, setServer } = harness();
    const p = fixture();
    const id = session.beginEdit({
      clipIds: ['c'],
      label: 'x',
      source: 'inspector',
    });
    session.previewEdit(id, [
      {
        op: 'clip.update',
        id: 'c',
        patch: { transform: { ...p.clips.c.transform, x: 10 } },
      },
    ]);
    const ai: Op[] = [
      {
        op: 'clip.update',
        id: 'c',
        patch: { transform: { ...p.clips.c.transform, rotation: 45 } },
      },
    ];
    setServer(applyOps(p, ai));
    await session.receiveAuthoritative({
      version: 1,
      actionId: 'rotate',
      ops: ai,
    });
    expect(session.getState().project.clips.c?.transform.rotation).toBe(0);
    expect((await session.commitEdit(id)).status).toBe('acknowledged');
    expect(session.getState().project.clips.c?.transform).toMatchObject({
      x: 10,
      rotation: 45,
    });
  });
  it('rebases a nested patch through 409 and an offline reload without erasing an agent field', async () => {
    const storage = memoryStorage();
    const a = harness({ storage, online: () => false });
    const p = fixture();
    await a.session.editGroup(
      [
        {
          op: 'clip.update',
          id: 'c',
          patch: { transform: { ...p.clips.c.transform, x: 10 } },
        },
      ],
      'x',
    );
    a.session.dispose();
    const ai: Op[] = [
      {
        op: 'clip.update',
        id: 'c',
        patch: { transform: { ...p.clips.c.transform, rotation: 90 } },
      },
    ];
    const newer = applyOps(p, ai);
    const b = harness({ storage, project: newer });
    b.setServer(newer);
    await b.session.flush();
    expect(b.session.getState().project.clips.c?.transform).toMatchObject({
      x: 10,
      rotation: 90,
    });
    const c = harness();
    c.setServer(newer);
    c.client.ops.mockRejectedValueOnce(new ApiError(409, 'stale'));
    expect(
      (
        await c.session.editGroup(
          [
            {
              op: 'clip.update',
              id: 'c',
              patch: { transform: { ...p.clips.c.transform, x: 10 } },
            },
          ],
          'x',
        )
      ).status,
    ).toBe('acknowledged');
    expect(c.session.getState().project.clips.c?.transform).toMatchObject({
      x: 10,
      rotation: 90,
    });
  });
});
