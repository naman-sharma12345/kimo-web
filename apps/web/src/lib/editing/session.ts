import {
  ApiError,
  applyOps,
  opSchema,
  type KimoProject,
  type Op,
  type SessionSnapshot,
} from '@kimo/client';
import { opClipIds, validateCommands } from './commands';
import { rebaseCommands } from './rebase';
import { textUpdate } from './text';
import {
  captureHistory,
  mergeHistoryRecord,
  historyOps,
  type HistoryRecord,
} from './history';
import {
  EditPersistenceError,
  validateOutbox,
  editIdentity,
  strictEditGuardSchema,
  type EditOutboxBinding,
  type EditOutboxRecord,
} from './persistence';
import type {
  EditReadiness,
  StrictEditGuard,
  EditGroupOptions,
  EditPersistenceStatus,
  AuthoritativeGroup,
  BeginEdit,
  EditContext,
  EditGroup,
  EditingAPI,
  EditResult,
  EditState,
} from './types';

type Pending = EditGroup & {
  before?: KimoProject;
  intentBaseline?: KimoProject;
  intentOps?: Op[];
  baseVersion?: number;
  acceptedVersion?: number;
  suppressProjection?: boolean;
  history: boolean;
  onAck?: (record: HistoryRecord) => void;
};
const clone = <T>(value: T): T => structuredClone(value);
/** One session, no sockets, no timers, no global network listeners. Parent supplies the single event stream. */
export function createEditingSession(context: EditContext): EditingAPI {
  let acknowledged = clone(context.project);
  let assets = clone([...(context.assets ?? [])]);
  let pending: Pending[] = [];
  let draft:
    (NonNullable<EditState['draft']> & { baseline: KimoProject }) | null = null;
  let disposed = false;
  let storageAvailable = false;
  let persistenceStatus: EditPersistenceStatus = 'hydrating';
  let binding: EditOutboxBinding | undefined;
  let saveTail: Promise<void> = Promise.resolve();
  let dirtyGeneration = 0;
  let savedGeneration = 0;
  let closeTask: Promise<void> | undefined;
  let error: string | undefined;
  let outboxUnreadable = false;
  let cachedState: EditState | null = null;
  let suggestions: EditState['suggestions'] = [];
  const abort = new AbortController();
  const listeners = new Set<(state: EditState) => void>();
  const userUndo: HistoryRecord[] = [];
  const userRedo: HistoryRecord[] = [];
  const agentHistory: HistoryRecord[] = [];
  const history: HistoryRecord[] = [];
  const completed = new Map<string, Promise<EditResult>>();
  const cancelled = new Set<string>();
  const received = new Map<number, AuthoritativeGroup>();
  const beforeVersion = new Map<number, KimoProject>();
  const ownVersions = new Map<number, string>();
  const settled = new Map<string, number>();
  let chain: Promise<void> = Promise.resolve();
  let snapshotRequest: Promise<void> | null = null;

  const makeId = context.makeId ?? (() => crypto.randomUUID());
  const online = () => context.online?.() ?? true;
  const assertLive = () => {
    if (disposed) throw new Error('Editing session is disposed');
  };
  const message = (cause: unknown) =>
    cause instanceof Error ? cause.message : String(cause);
  function storageFailure(cause: unknown) {
    storageAvailable = false;
    if (cause instanceof EditPersistenceError) persistenceStatus = cause.status;
    else if (
      persistenceStatus !== 'locked' &&
      persistenceStatus !== 'unreadable'
    )
      persistenceStatus = 'unavailable';
    error = `Editing storage unavailable: ${message(cause)}`;
    emit();
  }
  function envelope(): EditOutboxRecord {
    return structuredClone({
      format: 2,
      sessionId: context.sessionId,
      projectId: acknowledged.id,
      baseVersion: acknowledged.version,
      groups: pending.map(
        ({
          id,
          label,
          source,
          ops,
          status,
          baseVersion,
          acceptedVersion,
          intentBaseline,
          intentOps,
          strictGuard,
        }) => ({
          id,
          label,
          source,
          ops,
          ...(strictGuard ? { strictGuard } : {}),
          status: status === 'sending' ? ('unknown' as const) : status,
          ...(baseVersion === undefined ? {} : { baseVersion }),
          ...(acceptedVersion === undefined ? {} : { acceptedVersion }),
          ...(intentBaseline === undefined
            ? {}
            : { intentBaseline, intentOps }),
        }),
      ),
    });
  }
  function persist(): Promise<void> {
    const record = envelope();
    const generation = ++dirtyGeneration;
    const write = saveTail.then(async () => {
      if (!binding || !storageAvailable || outboxUnreadable)
        throw new Error('Durable editing storage is unavailable');
      await binding.save(record);
      savedGeneration = generation;
      if (!disposed) emit();
    });
    saveTail = write.catch((cause) => {
      if (!disposed) storageFailure(cause);
    });
    // All sync transition callers are safe; async dispatch callers still see rejection.
    void write.catch(() => undefined);
    return write;
  }
  function assertEditable() {
    assertLive();
    if (persistenceStatus === 'hydrating' || persistenceStatus === 'locked')
      throw new Error(
        persistenceStatus === 'locked'
          ? 'This project is being edited in another tab'
          : 'Editing storage is still loading',
      );
  }
  function makeStrictGuard(
    project: KimoProject,
    ops: readonly Op[],
  ): StrictEditGuard {
    return {
      sessionId: context.sessionId,
      projectId: project.id,
      version: project.version,
      projectIdentity: editIdentity(project),
      assetsIdentity: editIdentity(assets),
      opsIdentity: editIdentity(ops),
    };
  }
  function assertStrict(
    guard: StrictEditGuard,
    ops: readonly Op[],
    own?: Pending,
  ) {
    strictEditGuardSchema.parse(guard);
    if (
      guard.sessionId !== context.sessionId ||
      guard.projectId !== acknowledged.id ||
      guard.version !== acknowledged.version ||
      guard.projectIdentity !== editIdentity(acknowledged) ||
      guard.assetsIdentity !== editIdentity(assets) ||
      guard.opsIdentity !== editIdentity(ops)
    )
      throw new Error(
        'Restore review is stale; re-plan and review against the current project and assets',
      );
    if (
      !online() ||
      !storageAvailable ||
      persistenceStatus !== 'ready' ||
      (!own && dirtyGeneration !== savedGeneration) ||
      draft ||
      suggestions.length ||
      pending.some((g) => g !== own) ||
      [...received.keys()].some((version) => version > acknowledged.version)
    )
      throw new Error(
        'Restore requires online, saved, ready authority without pending edits or drafts',
      );
  }
  function projection(): KimoProject {
    let project = acknowledged;
    for (const group of pending) {
      // A metadata-free event can be an own echo. Never replay ambiguous non-idempotent ops over it.
      if (
        group.suppressProjection ||
        group.acceptedVersion !== undefined ||
        (group.status === 'unknown' &&
          group.baseVersion !== acknowledged.version) ||
        [...ownVersions.values()].includes(group.id) ||
        (group.status === 'sending' &&
          group.before &&
          [...received.values()].some(
            (event) =>
              event.version > (group.before?.version ?? acknowledged.version) &&
              !event.actionId &&
              event.author !== 'agent' &&
              !event.clientMutationId,
          ))
      )
        continue;
      try {
        if (
          group.strictGuard &&
          group.strictGuard.projectIdentity !== editIdentity(acknowledged)
        )
          continue;
        const optimistic = group.intentBaseline
          ? rebaseCommands(
              group.intentBaseline,
              project,
              group.intentOps ?? group.ops,
            )
          : group.ops;
        project = applyOps(project, optimistic, acknowledged.version);
      } catch {
        /* Keep a valid authoritative projection; unsaved group remains visible in state. */
      }
    }
    if (draft) {
      project = clone(project);
      for (const id of draft.clipIds) {
        const baseline = draft.baseline.clips[id];
        if (baseline && acknowledged.clips[id])
          project.clips[id] = clone(baseline);
      }
      project = applyOps(project, draft.ops, acknowledged.version);
    }
    return project;
  }
  function getState(): EditState {
    if (cachedState) return cachedState;
    const saveStatus = disposed
      ? 'disposed'
      : persistenceStatus === 'hydrating'
        ? 'pending'
        : !storageAvailable || dirtyGeneration !== savedGeneration
          ? 'unsaved'
          : pending.some((g) => g.status === 'unknown')
            ? 'unknown'
            : outboxUnreadable ||
                pending.some((g) => g.status === 'failed') ||
                (pending.length && !storageAvailable)
              ? 'unsaved'
              : pending.length
                ? online()
                  ? 'pending'
                  : 'offline'
                : draft
                  ? 'draft'
                  : [...received.keys()].some(
                        (version) => version > acknowledged.version,
                      )
                    ? 'pending'
                    : 'saved';
    cachedState = {
      online: online(),
      persistenceStatus: disposed ? 'disposed' : persistenceStatus,
      persistencePending: dirtyGeneration !== savedGeneration,
      editingEnabled:
        !disposed && !['hydrating', 'locked'].includes(persistenceStatus),
      dispatchEnabled:
        !disposed && storageAvailable && persistenceStatus === 'ready',
      project: projection(),
      acknowledged,
      acknowledgedVersion: acknowledged.version,
      assets,
      pending: pending.map(({ id, label, source, ops, status }) => ({
        id,
        label,
        source,
        ops,
        status,
      })),
      draft: draft
        ? {
            id: draft.id,
            clipIds: draft.clipIds,
            label: draft.label,
            source: draft.source,
            ops: draft.ops,
          }
        : null,
      saveStatus,
      storageAvailable,
      canUndo:
        storageAvailable &&
        dirtyGeneration === savedGeneration &&
        !!userUndo[userUndo.length - 1]?.available &&
        !pending.length &&
        !draft,
      canRedo:
        storageAvailable &&
        dirtyGeneration === savedGeneration &&
        !!userRedo[userRedo.length - 1]?.available &&
        !pending.length &&
        !draft,
      history: history.map(({ id, label, author, actionId, available }) => ({
        id,
        label,
        author,
        actionId,
        available,
      })),
      suggestions,
      ...(error ? { error } : {}),
    };
    return cachedState;
  }
  function safeCall(callback: () => void) {
    try {
      callback();
    } catch (cause) {
      error = `Editing integration callback failed: ${message(cause)}`;
    }
  }
  function emit() {
    if (disposed) return;
    cachedState = null;
    const state = getState();
    safeCall(() => context.projectChanged?.(state.project));
    for (const listener of listeners) safeCall(() => listener(state));
  }
  function replaceSnapshot(
    snapshot: Pick<SessionSnapshot, 'project' | 'assets'>,
  ) {
    assertLive();
    if (snapshot.project.id !== acknowledged.id)
      throw new Error('Snapshot belongs to another project');
    if (snapshot.project.version < acknowledged.version) return;
    const removed = Object.keys(acknowledged.clips).filter(
      (id) => !snapshot.project.clips[id],
    );
    if (removed.length) handleRemoved(removed, acknowledged);
    for (const group of pending)
      if (
        group.status !== 'unsent' &&
        (group.baseVersion ?? acknowledged.version) < snapshot.project.version
      )
        group.suppressProjection = true;
    acknowledged = clone(snapshot.project);
    assets = clone(snapshot.assets);
    safeCall(() => context.assetsChanged?.(assets));
    for (const version of received.keys())
      if (version <= acknowledged.version) received.delete(version);
    if (storageAvailable) void persist();
    emit();
  }
  async function refresh() {
    if (!snapshotRequest)
      snapshotRequest = (async () => {
        const snapshot = await context.client.session(context.sessionId, {
          signal: abort.signal,
        });
        if (!disposed) replaceSnapshot(snapshot);
      })().finally(() => {
        snapshotRequest = null;
      });
    await snapshotRequest;
  }
  function rememberBefore(version: number) {
    beforeVersion.set(version, clone(acknowledged));
    if (beforeVersion.size > 128) {
      const oldest = beforeVersion.keys().next().value;
      if (oldest !== undefined) beforeVersion.delete(oldest);
    }
  }
  function handleRemoved(ids: string[], before: KimoProject) {
    safeCall(() => context.selectionRemoved?.(ids));
    if (draft && ids.some((id) => draft?.clipIds.includes(id))) {
      cancelled.add(draft.id);
      const lockedIds = draft.clipIds;
      suggestions = suggestions.filter(
        (suggestion) => !lockedIds.includes(suggestion.clipId),
      );
      draft = null;
      const restore: Op[] = ids.flatMap((id) => {
        const clip = before.clips[id];
        return clip ? [{ op: 'clip.add' as const, clip: clone(clip) }] : [];
      });
      safeCall(() =>
        context.notifications?.toast(
          'kimo removed a clip you were editing · undo',
          {
            label: 'undo',
            run: () => {
              void editGroup(restore, 'restore removed clip', 'history');
            },
          },
        ),
      );
    }
  }
  function confirm(group: Pending, version: number, before: KimoProject) {
    if (settled.has(group.id)) return;
    settled.set(group.id, version);
    ownVersions.set(version, group.id);
    const entry = captureHistory(before, group.ops, {
      id: group.id,
      label: group.label,
      author: 'user',
    });
    if (group.strictGuard)
      entry.strict = {
        project: applyOps(before, group.ops, version),
        assetsIdentity: group.strictGuard.assetsIdentity,
      };
    if (before.version !== version - 1) entry.available = false;
    if (group.history) {
      history.push(entry);
      userUndo.push(entry);
    }
    group.onAck?.(entry);
    pending = pending.filter((item) => item.id !== group.id);
    safeCall(() =>
      context.activity?.(
        group.label === 'title text'
          ? 'you changed the title text'
          : `you changed ${group.label}`,
      ),
    );
    if (settled.size > 256) {
      const oldest = settled.keys().next().value;
      if (oldest !== undefined) settled.delete(oldest);
    }
    persist();
  }
  function applyAuthority(group: AuthoritativeGroup) {
    const before = acknowledged;
    rememberBefore(group.version);
    acknowledged = applyOps(before, group.ops, group.version);
    if (group.actionId && group.author !== 'user') {
      const entry = captureHistory(before, group.ops, {
        id: makeId(),
        label: group.actionId,
        author: 'agent',
        actionId: group.actionId,
      });
      const existing = agentHistory.find(
        (item) => item.actionId === group.actionId,
      );
      if (existing) mergeHistoryRecord(existing, entry);
      else {
        agentHistory.push(entry);
        history.push(entry);
      }
    }
    const removes = group.ops.filter(
      (op): op is Extract<Op, { op: 'clip.remove' }> => op.op === 'clip.remove',
    );
    if (removes.length)
      handleRemoved(
        removes.map((op) => op.id),
        before,
      );
    if (draft)
      for (const op of group.ops) {
        if (op.op === 'text.update' && draft.clipIds.includes(op.clipId))
          suggestions = [
            ...suggestions.filter((s) => s.clipId !== op.clipId),
            {
              clipId: op.clipId,
              content: op.content,
              version: group.version,
              actionId: group.actionId,
            },
          ];
        else if (
          op.op === 'clip.update' &&
          op.patch.text &&
          draft.clipIds.includes(op.id)
        )
          suggestions = [
            ...suggestions.filter((s) => s.clipId !== op.id),
            {
              clipId: op.id,
              content: op.patch.text.content,
              version: group.version,
              actionId: group.actionId,
            },
          ];
      }
  }
  async function receiveAuthoritative(group: AuthoritativeGroup) {
    await readiness;
    if (disposed) return;
    assertLive();
    if (!Number.isSafeInteger(group.version) || group.version < 0)
      throw new Error(
        'Authoritative version must be a nonnegative safe integer',
      );
    if (group.version <= acknowledged.version) {
      const own = pending.find((item) => item.id === group.clientMutationId);
      if (own) {
        confirm(
          own,
          group.version,
          beforeVersion.get(group.version) ?? own.before ?? acknowledged,
        );
        await saveTail;
        emit();
      }
      return;
    }
    const parsed = { ...group, ops: group.ops.map((op) => opSchema.parse(op)) };
    received.set(group.version, parsed);
    if (group.version > acknowledged.version + 1) {
      try {
        await refresh();
      } catch (cause) {
        if (!disposed) {
          error = `Snapshot unavailable: ${message(cause)}`;
          emit();
        }
        return;
      }
      if (disposed) return;
    }
    let next = received.get(acknowledged.version + 1);
    while (next) {
      // Retain metadata-free in-flight events until the HTTP version proves identity.
      applyAuthority(next);
      if (
        next.actionId ||
        next.author ||
        next.clientMutationId ||
        !pending.some((g) => g.status === 'sending')
      )
        received.delete(next.version);
      if (next.clientMutationId) {
        const mutationId = next.clientMutationId;
        const own = pending.find((g) => g.id === mutationId);
        if (own)
          confirm(
            own,
            next.version,
            beforeVersion.get(next.version) ?? own.before ?? acknowledged,
          );
      }
      next = received.get(acknowledged.version + 1);
    }
    if ([...received.keys()].some((version) => version > acknowledged.version))
      error =
        'A server update is missing; waiting for a newer snapshot or packet';
    else if (
      error?.startsWith('A server update is missing') ||
      error?.startsWith('Snapshot unavailable:')
    )
      error = undefined;
    await saveTail;
    emit();
  }
  async function send(group: Pending): Promise<EditResult> {
    if (disposed) return { id: group.id, status: 'cancelled' };
    if (!storageAvailable)
      return {
        id: group.id,
        status: 'failed',
        error: error ?? 'Durable editing storage unavailable',
      };
    if (!online()) return { id: group.id, status: 'queued' };
    if (
      pending.some(
        (g) => g !== group && ['unknown', 'failed'].includes(g.status),
      )
    )
      return { id: group.id, status: 'queued' };
    let dispatched = false;
    let before = clone(acknowledged);
    const prepare = async (): Promise<boolean> => {
      while (!disposed && pending.includes(group) && !settled.has(group.id)) {
        if (!storageAvailable)
          throw new Error('Durable editing storage unavailable');
        if (group.strictGuard)
          assertStrict(group.strictGuard, group.ops, group);
        const base = clone(acknowledged);
        const ops = validateCommands(
          acknowledged,
          group.intentBaseline
            ? rebaseCommands(
                group.intentBaseline,
                acknowledged,
                group.intentOps ?? group.ops,
              )
            : group.ops,
          assets,
        );
        group.ops = clone(ops);
        group.before = base;
        group.baseVersion = base.version;
        group.status = 'sending';
        before = base;
        await persist(); // exact payload/base is UNKNOWN durably before invocation
        if (disposed || settled.has(group.id) || !pending.includes(group))
          return false;
        if (!storageAvailable)
          throw new Error('Durable editing storage unavailable');
        if (!online()) {
          group.status = 'unsent';
          await persist();
          return false;
        }
        if (group.strictGuard)
          assertStrict(group.strictGuard, group.ops, group);
        if (base.version === acknowledged.version) return true;
      }
      return false;
    };
    const requestOptions = {
      signal: abort.signal,
      ...(context.mutationIdentity ? { clientMutationId: group.id } : {}),
    };
    const invoke = async (): Promise<{ version: number } | undefined> => {
      while (await prepare()) {
        // prepare's resolution is itself an async boundary: fence again HERE.
        if (disposed || !pending.includes(group) || settled.has(group.id))
          return;
        if (!storageAvailable)
          throw new Error('Durable editing storage unavailable');
        if (group.strictGuard)
          assertStrict(group.strictGuard, group.ops, group);
        if (!online() || group.baseVersion !== acknowledged.version) continue;
        dispatched = true;
        return context.client.ops(
          context.sessionId,
          group.ops,
          group.baseVersion,
          requestOptions,
        );
      }
    };
    try {
      let response: { version: number } | undefined;
      try {
        response = await invoke();
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.status !== 409) throw cause;
        dispatched = false;
        await refresh();
        if (group.strictGuard)
          throw new Error(
            'Restore conflict (409); re-plan and review before another submission',
          );
        group.suppressProjection = false;
        response = await invoke();
      }
      if (!response)
        return {
          id: group.id,
          status: disposed
            ? 'cancelled'
            : settled.has(group.id)
              ? 'acknowledged'
              : 'queued',
        };
      if (disposed) return { id: group.id, status: 'cancelled' };
      if (settled.has(group.id)) {
        await saveTail;
        return { id: group.id, status: 'acknowledged' };
      }
      if (
        !Number.isSafeInteger(response.version) ||
        response.version <= (group.baseVersion ?? -1)
      )
        throw new Error('Write acknowledgement did not advance server version');
      group.acceptedVersion = response.version;
      ownVersions.set(response.version, group.id);
      // Persist acceptance before any further snapshot await. Failure cannot undo proven acceptance.
      await persist().catch(() => undefined);
      if (disposed) return { id: group.id, status: 'cancelled' };
      if (response.version === acknowledged.version + 1) {
        rememberBefore(response.version);
        before = clone(acknowledged);
        acknowledged = applyOps(acknowledged, group.ops, response.version);
      } else if (response.version > acknowledged.version + 1) {
        await refresh();
        if (disposed) return { id: group.id, status: 'cancelled' };
        if (acknowledged.version < response.version)
          throw new Error(
            'Acknowledged write is ahead of the available snapshot',
          );
      }
      confirm(
        group,
        response.version,
        beforeVersion.get(response.version) ?? before,
      );
      received.delete(response.version);
      if (ownVersions.size > 128) {
        const first = ownVersions.keys().next().value;
        if (first !== undefined) ownVersions.delete(first);
      }
      await saveTail;
      if (storageAvailable) error = undefined;
      emit();
      return { id: group.id, status: 'acknowledged' };
    } catch (cause) {
      if (disposed) return { id: group.id, status: 'cancelled' };
      if (settled.has(group.id)) {
        await saveTail;
        return { id: group.id, status: 'acknowledged' };
      }
      const rejected =
        cause instanceof ApiError &&
        [400, 401, 403, 404, 409, 422, 429].includes(cause.status);
      group.status = !dispatched
        ? storageAvailable
          ? 'failed'
          : 'unsent'
        : rejected
          ? 'failed'
          : 'unknown';
      if (group.strictGuard && (!dispatched || rejected))
        pending = pending.filter((item) => item !== group);
      if (storageAvailable) error = message(cause);
      await persist().catch(() => undefined);
      emit();
      return {
        id: group.id,
        status: group.status === 'unknown' ? 'unknown' : 'failed',
        error: error ?? message(cause),
      };
    }
  }
  function schedule(group: Pending): Promise<EditResult> {
    let result: EditResult = { id: group.id, status: 'queued' };
    const scheduled = chain.then(async () => {
      await readiness;
      await saveTail;
      if (pending.includes(group) && group.status === 'unsent')
        result = await send(group);
    });
    chain = scheduled.catch(() => {
      /* send returns explicit results; keep serialization live */
    });
    return scheduled.then(() => result);
  }
  function enqueue(
    ops: readonly Op[],
    label: string,
    source: BeginEdit['source'],
    id = makeId(),
    normalHistory = true,
    onAck?: Pending['onAck'],
    strictGuard?: StrictEditGuard,
  ): Promise<EditResult> {
    assertEditable();
    if (strictGuard) assertStrict(strictGuard, ops);
    if (!ops.length) return Promise.resolve({ id, status: 'cancelled' });
    const baseline = projection();
    const parsed = validateCommands(baseline, ops, assets);
    const group: Pending = {
      id,
      label,
      source,
      ops: clone(parsed),
      intentOps: clone(parsed),
      intentBaseline: clone({
        ...baseline,
        clips: Object.fromEntries(
          [...new Set(parsed.flatMap(opClipIds))].flatMap((clipId) => {
            const clip = baseline.clips[clipId];
            return clip ? [[clipId, clip]] : [];
          }),
        ),
        markers: [],
      }),
      status: 'unsent',
      history: normalHistory,
      onAck,
    };
    if (strictGuard) {
      group.strictGuard = clone(strictGuard);
      delete group.intentBaseline;
      delete group.intentOps;
    }
    pending.push(group);
    if (normalHistory) userRedo.length = 0;
    persist();
    emit();
    return schedule(group);
  }
  function beginEdit(input: BeginEdit): string {
    assertEditable();
    if (draft) throw new Error('Finish or cancel the active edit first');
    const baseline = projection();
    for (const id of input.clipIds) {
      const c = baseline.clips[id];
      if (
        !c ||
        c.locked ||
        baseline.tracks.find((t) => t.id === c.trackId)?.locked
      )
        throw new Error('Clip is unavailable or locked');
    }
    const id = makeId();
    draft = {
      ...input,
      clipIds: [...input.clipIds],
      id,
      ops: [],
      baseline: clone(baseline),
    };
    emit();
    return id;
  }
  function previewEdit(id: string, ops: readonly Op[]) {
    if (disposed) return;
    if (!draft || draft.id !== id) {
      if (cancelled.has(id)) return;
      throw new Error('Edit is no longer active');
    }
    draft.ops = validateCommands(draft.baseline, ops, assets);
    emit();
  }
  function cancelEdit(id: string) {
    if (disposed) return;
    if (draft?.id === id) {
      const lockedIds = draft.clipIds;
      suggestions = suggestions.filter(
        (suggestion) => !lockedIds.includes(suggestion.clipId),
      );
      draft = null;
      cancelled.add(id);
      emit();
    }
  }
  function commitEdit(id: string, ops?: readonly Op[]): Promise<EditResult> {
    if (disposed) return Promise.resolve({ id, status: 'cancelled' });
    const existing = completed.get(id);
    if (existing) return existing;
    if (!draft || draft.id !== id)
      return Promise.resolve({ id, status: 'cancelled' });
    if (ops) previewEdit(id, ops);
    const active = draft;
    suggestions = suggestions.filter(
      (suggestion) => !active.clipIds.includes(suggestion.clipId),
    );
    draft = null;
    try {
      const promise = enqueue(
        rebaseCommands(active.baseline, projection(), active.ops),
        active.label,
        active.source,
        active.id,
      );
      completed.set(id, promise);
      return promise;
    } catch (cause) {
      error = message(cause);
      emit();
      const promise = Promise.resolve<EditResult>({
        id,
        status: 'failed',
        error,
      });
      completed.set(id, promise);
      return promise;
    }
  }
  async function editGroup(
    ops: readonly Op[],
    label: string,
    source: BeginEdit['source'] = 'inspector',
    options?: EditGroupOptions,
  ) {
    const guard = options?.strictGuard ? clone(options.strictGuard) : undefined;
    if (guard) assertStrict(guard, ops);
    await readiness;
    return enqueue(ops, label, source, makeId(), true, undefined, guard);
  }
  async function undoUser(): Promise<EditResult> {
    await readiness;
    assertEditable();
    const entry = userUndo[userUndo.length - 1];
    if (!entry || pending.length || draft)
      return { id: '', status: 'cancelled' };
    try {
      if (
        entry.strict &&
        (editIdentity(acknowledged) !== editIdentity(entry.strict.project) ||
          editIdentity(assets) !== entry.strict.assetsIdentity)
      )
        throw new Error(
          'Strict restore history is stale; newer edits or assets must be preserved',
        );
      const ops = historyOps(acknowledged, entry, 'undo');
      return await enqueue(
        ops,
        `undo ${entry.label}`,
        'history',
        makeId(),
        false,
        (compensation) => {
          userUndo.pop();
          userRedo.push({ ...compensation, label: entry.label });
        },
        entry.strict ? makeStrictGuard(acknowledged, ops) : undefined,
      );
    } catch (cause) {
      error = message(cause);
      emit();
      return { id: entry.id, status: 'failed', error };
    }
  }
  async function redoUser(): Promise<EditResult> {
    await readiness;
    assertEditable();
    const entry = userRedo[userRedo.length - 1];
    if (!entry || pending.length || draft)
      return { id: '', status: 'cancelled' };
    try {
      if (
        entry.strict &&
        (editIdentity(acknowledged) !== editIdentity(entry.strict.project) ||
          editIdentity(assets) !== entry.strict.assetsIdentity)
      )
        throw new Error(
          'Strict restore history is stale; newer edits or assets must be preserved',
        );
      const ops = historyOps(acknowledged, entry, 'undo');
      return await enqueue(
        ops,
        `redo ${entry.label}`,
        'history',
        makeId(),
        false,
        (compensation) => {
          userRedo.pop();
          userUndo.push({ ...compensation, label: entry.label });
        },
        entry.strict ? makeStrictGuard(acknowledged, ops) : undefined,
      );
    } catch (cause) {
      error = message(cause);
      emit();
      return { id: entry.id, status: 'failed', error };
    }
  }
  async function revertAgentGroup(actionId: string): Promise<EditResult> {
    await readiness;
    assertEditable();
    const entries = agentHistory.filter((entry) => entry.actionId === actionId);
    if (!entries.length)
      return {
        id: actionId,
        status: 'failed',
        error:
          'Preimages for this action are unavailable; reload history contains IDs only',
      };
    try {
      return await editGroup(
        historyOps(
          acknowledged,
          entries[0] ?? {
            id: actionId,
            label: actionId,
            author: 'agent',
            changes: [],
            available: false,
          },
          'undo',
        ),
        'revert this step',
        'history',
      );
    } catch (cause) {
      return { id: actionId, status: 'failed', error: message(cause) };
    }
  }
  function resolveTextSuggestion(
    clipId: string,
    choice: 'use it' | 'keep mine',
  ) {
    assertLive();
    const suggestion = suggestions.find((s) => s.clipId === clipId);
    if (suggestion && draft) {
      const clip =
        choice === 'use it'
          ? acknowledged.clips[clipId]
          : projection().clips[clipId];
      if (clip?.text)
        draft.ops = [
          ...draft.ops.filter(
            (op) => !(op.op === 'text.update' && op.clipId === clipId),
          ),
          textUpdate(
            clip,
            choice === 'use it' ? suggestion.content : clip.text.content,
            clip.text.secondaryContent,
          ),
        ];
    }
    suggestions = suggestions.filter((s) => s.clipId !== clipId);
    emit();
  }
  async function flush() {
    await readiness;
    assertLive();
    if (!storageAvailable) return;
    for (const group of pending)
      if (group.status === 'unsent') await schedule(group);
    await chain;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const group of pending)
      if (group.status === 'sending') group.status = 'unknown';
    abort.abort();
    draft = null;
    cachedState = null;
    const state = getState();
    for (const listener of listeners) safeCall(() => listener(state));
    listeners.clear();
    closeTask = readiness
      .then(() => saveTail)
      .then(() => binding?.close())
      .then(() => undefined);
  }
  const readiness: Promise<EditReadiness> = (async () => {
    let unavailableDuringOpen = false;
    try {
      await context.persistenceReadyAfter;
      if (disposed) return { status: 'disposed' };
      if (!context.persistence)
        throw new EditPersistenceError(
          'unavailable',
          'Durable editing storage is not configured',
        );
      const opened = await context.persistence.open(
        { sessionId: context.sessionId, projectId: context.project.id },
        {
          signal: abort.signal,
          legacyStorage: context.storage,
          onUnavailable: (cause) => {
            unavailableDuringOpen = true;
            if (!disposed) storageFailure(cause);
          },
        },
      );
      binding = opened;
      if (disposed) {
        await opened.close();
        return { status: 'disposed' };
      }
      if (unavailableDuringOpen)
        throw new Error('Editing storage became unavailable during hydration');
      if (opened.record) {
        const saved = validateOutbox(opened.record, {
          sessionId: context.sessionId,
          projectId: acknowledged.id,
        });
        pending = saved.groups.map((group) => ({
          ...group,
          history: true,
          status:
            saved.baseVersion > acknowledged.version ||
            group.acceptedVersion !== undefined
              ? 'unknown'
              : group.status,
          ...(group.baseVersion === acknowledged.version
            ? { before: clone(acknowledged) }
            : {}),
        }));
      }
      storageAvailable = true;
      persistenceStatus = 'ready';
      emit();
      return { status: 'ready' };
    } catch (cause) {
      if (disposed) return { status: 'disposed' };
      outboxUnreadable =
        cause instanceof EditPersistenceError && cause.status === 'unreadable';
      storageFailure(cause);
      await binding?.close();
      return { status: persistenceStatus as EditReadiness['status'], error };
    }
  })();
  return {
    ready: () => readiness,
    closed: () => closeTask ?? Promise.resolve(),
    getState,
    subscribe(listener) {
      if (disposed) {
        safeCall(() => listener(getState()));
        return () => undefined;
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    beginEdit,
    previewEdit,
    commitEdit,
    cancelEdit,
    editGroup,
    undoUser,
    redoUser,
    revertAgentGroup,
    receiveAuthoritative,
    replaceSnapshot,
    resolveTextSuggestion,
    flush,
    dispose,
  };
}
