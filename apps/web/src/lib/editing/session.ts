import { z } from 'zod';
import {
  ApiError,
  applyOps,
  opSchema,
  projectSchema,
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
import type {
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
const sourceSchema = z.enum([
  'timeline',
  'inspector',
  'viewer',
  'captions',
  'keyboard',
  'history',
  'assets',
]);
const outboxSchema = z.object({
  format: z.literal(1),
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  baseVersion: z.number().int().nonnegative().safe(),
  groups: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string(),
      source: sourceSchema,
      ops: z.array(opSchema),
      status: z.enum(['unsent', 'failed', 'unknown']),
      baseVersion: z.number().int().nonnegative().safe().optional(),
      acceptedVersion: z.number().int().nonnegative().safe().optional(),
      intentBaseline: projectSchema.optional(),
      intentOps: z.array(opSchema).optional(),
    }),
  ),
});
/** One session, no sockets, no timers, no global network listeners. Parent supplies the single event stream. */
export function createEditingSession(context: EditContext): EditingAPI {
  let acknowledged = clone(context.project);
  let assets = clone([...(context.assets ?? [])]);
  let pending: Pending[] = [];
  let draft:
    (NonNullable<EditState['draft']> & { baseline: KimoProject }) | null = null;
  let disposed = false;
  let storageAvailable = context.storage !== undefined;
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
  const key = `kimo:editing:1:${encodeURIComponent(context.sessionId)}:${encodeURIComponent(context.project.id)}`;
  const makeId = context.makeId ?? (() => crypto.randomUUID());
  const online = () => context.online?.() ?? true;
  const assertLive = () => {
    if (disposed) throw new Error('Editing session is disposed');
  };
  const message = (cause: unknown) =>
    cause instanceof Error ? cause.message : String(cause);
  function persist() {
    if (outboxUnreadable) {
      storageAvailable = false;
      return;
    }
    if (!context.storage) {
      storageAvailable = false;
      return;
    }
    try {
      if (!pending.length) context.storage.removeItem(key);
      else
        context.storage.setItem(
          key,
          JSON.stringify({
            format: 1,
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
              }) => ({
                id,
                label,
                source,
                ops,
                status: status === 'sending' ? 'unknown' : status,
                ...(baseVersion === undefined ? {} : { baseVersion }),
                ...(acceptedVersion === undefined ? {} : { acceptedVersion }),
                ...(intentBaseline === undefined
                  ? {}
                  : { intentBaseline, intentOps }),
              }),
            ),
          }),
        );
      storageAvailable = true;
    } catch {
      storageAvailable = false;
    }
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
        !!userUndo[userUndo.length - 1]?.available && !pending.length && !draft,
      canRedo:
        !!userRedo[userRedo.length - 1]?.available && !pending.length && !draft,
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
    emit();
  }
  async function send(group: Pending): Promise<EditResult> {
    if (disposed) return { id: group.id, status: 'cancelled' };
    if (!online()) {
      persist();
      emit();
      return { id: group.id, status: 'queued' };
    }
    if (
      pending.some(
        (g) => g !== group && ['unknown', 'failed'].includes(g.status),
      )
    )
      return { id: group.id, status: 'queued' };
    group.status = 'sending';
    group.before = clone(acknowledged);
    group.baseVersion = acknowledged.version;
    persist();
    emit();
    let response: { version: number };
    let dispatched = false;
    const requestOptions = {
      signal: abort.signal,
      ...(context.mutationIdentity ? { clientMutationId: group.id } : {}),
    };
    let before = group.before;
    try {
      group.ops = validateCommands(
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
      try {
        dispatched = true;
        response = await context.client.ops(
          context.sessionId,
          group.ops,
          acknowledged.version,
          requestOptions,
        );
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.status !== 409) throw cause;
        dispatched = false;
        await refresh();
        if (disposed) return { id: group.id, status: 'cancelled' };
        group.ops = validateCommands(
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
        before = clone(acknowledged);
        group.before = before;
        group.baseVersion = acknowledged.version;
        group.suppressProjection = false;
        dispatched = true;
        response = await context.client.ops(
          context.sessionId,
          group.ops,
          acknowledged.version,
          requestOptions,
        );
      }
      if (disposed) return { id: group.id, status: 'cancelled' };
      if (settled.has(group.id))
        return { id: group.id, status: 'acknowledged' };
      if (
        !Number.isSafeInteger(response.version) ||
        response.version <= (group.baseVersion ?? -1)
      )
        throw new Error('Write acknowledgement did not advance server version');
      group.acceptedVersion = response.version;
      ownVersions.set(response.version, group.id);
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
      const preimage = beforeVersion.get(response.version) ?? before;
      confirm(group, response.version, preimage);
      received.delete(response.version);
      if (ownVersions.size > 128) {
        const first = ownVersions.keys().next().value;
        if (first !== undefined) ownVersions.delete(first);
      }
      error = undefined;
      persist();
      emit();
      return { id: group.id, status: 'acknowledged' };
    } catch (cause) {
      if (disposed) return { id: group.id, status: 'cancelled' };
      if (settled.has(group.id))
        return { id: group.id, status: 'acknowledged' };
      // HTTP 4xx proves rejection. Transport/5xx/parse failures do not prove nonacceptance.
      const rejected =
        cause instanceof ApiError &&
        [400, 401, 403, 404, 409, 422, 429].includes(cause.status);
      group.status = rejected || !dispatched ? 'failed' : 'unknown';
      error = message(cause);
      persist();
      emit();
      return {
        id: group.id,
        status: group.status === 'unknown' ? 'unknown' : 'failed',
        error,
      };
    }
  }
  function schedule(group: Pending): Promise<EditResult> {
    let result: EditResult = { id: group.id, status: 'queued' };
    const scheduled = chain.then(async () => {
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
  ): Promise<EditResult> {
    assertLive();
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
    pending.push(group);
    if (normalHistory) userRedo.length = 0;
    persist();
    emit();
    return schedule(group);
  }
  function beginEdit(input: BeginEdit): string {
    assertLive();
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
  function editGroup(
    ops: readonly Op[],
    label: string,
    source: BeginEdit['source'] = 'inspector',
  ) {
    return enqueue(ops, label, source);
  }
  async function undoUser(): Promise<EditResult> {
    assertLive();
    const entry = userUndo[userUndo.length - 1];
    if (!entry || pending.length || draft)
      return { id: '', status: 'cancelled' };
    try {
      return await enqueue(
        historyOps(acknowledged, entry, 'undo'),
        `undo ${entry.label}`,
        'history',
        makeId(),
        false,
        (compensation) => {
          userUndo.pop();
          userRedo.push({ ...compensation, label: entry.label });
        },
      );
    } catch (cause) {
      error = message(cause);
      emit();
      return { id: entry.id, status: 'failed', error };
    }
  }
  async function redoUser(): Promise<EditResult> {
    assertLive();
    const entry = userRedo[userRedo.length - 1];
    if (!entry || pending.length || draft)
      return { id: '', status: 'cancelled' };
    try {
      return await enqueue(
        historyOps(acknowledged, entry, 'undo'),
        `redo ${entry.label}`,
        'history',
        makeId(),
        false,
        (compensation) => {
          userRedo.pop();
          userUndo.push({ ...compensation, label: entry.label });
        },
      );
    } catch (cause) {
      error = message(cause);
      emit();
      return { id: entry.id, status: 'failed', error };
    }
  }
  async function revertAgentGroup(actionId: string): Promise<EditResult> {
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
    assertLive();
    for (const group of pending)
      if (group.status === 'unsent') await schedule(group);
    await chain;
  }
  function dispose() {
    if (disposed) return;
    for (const group of pending)
      if (group.status === 'sending') group.status = 'unknown';
    persist();
    disposed = true;
    abort.abort();
    draft = null;
    cachedState = null;
    const state = getState();
    for (const listener of listeners) safeCall(() => listener(state));
    listeners.clear();
  }
  if (context.storage) {
    try {
      const raw = context.storage.getItem(key);
      if (raw) {
        const saved = outboxSchema.parse(JSON.parse(raw));
        if (
          saved.sessionId !== context.sessionId ||
          saved.projectId !== acknowledged.id
        )
          throw new Error('Stored edits do not match this session');
        if (
          new Set(saved.groups.map((group) => group.id)).size !==
          saved.groups.length
        )
          throw new Error('Stored edit IDs must be unique');
        if (
          saved.groups.some(
            (group) =>
              group.intentBaseline &&
              group.intentBaseline.id !== acknowledged.id,
          )
        )
          throw new Error('Stored intent belongs to another project');
        pending = saved.groups.map((group) => ({
          ...group,
          history: true,
          status:
            saved.baseVersion > acknowledged.version ? 'unknown' : group.status,
          ...(group.baseVersion === acknowledged.version
            ? { before: clone(acknowledged) }
            : {}),
        }));
      }
    } catch (cause) {
      outboxUnreadable = true;
      storageAvailable = false;
      error = message(cause);
    }
  }
  return {
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
