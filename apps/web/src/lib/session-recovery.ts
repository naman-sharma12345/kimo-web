import type { KimoClient, ServerEvent, SessionSnapshot } from '@kimo/client';

export const recoveryTiming = {
  backoff: [1000, 2000, 4000, 8000, 15000],
  handshake: 5000,
  stable: 15000,
  maxBufferedEvents: 256,
} as const;
export type RecoveryStatus =
  'restoring' | 'reconnecting' | 'connected' | 'stopped';
export type RecoveryFailure = {
  kind:
    'auth' | 'not-found' | 'expired' | 'failed' | 'missing-url' | 'consumer';
  message: string;
};
export interface SessionRecoveryOptions {
  sessionId: string;
  api: Pick<KimoClient, 'session' | 'connect'>;
  onSnapshot: (snapshot: SessionSnapshot) => 'continue' | 'stop';
  onEvent: (event: ServerEvent) => void | Promise<void>;
  onStatus: (status: RecoveryStatus) => void;
  onSocket: (socket: WebSocket | undefined) => void;
  onFatal: (failure: RecoveryFailure) => void;
  onlineTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}
const failures: Record<RecoveryFailure['kind'], string> = {
  auth: 'sign in to reconnect to this session.',
  'not-found': 'this session could not be found.',
  expired: 'this session has expired.',
  failed: 'this session could not be started.',
  'missing-url': 'this session has no live connection.',
  consumer: 'couldn’t restore this session safely.',
};

/** One owner per mounted lifecycle. This controller never dispatches or replays writes.
 * Connected is a transport gate only: unknown/failed outbox groups still block flush.
 * No cursor replay, atomic REST/WS snapshot or idempotency agreement is assumed.
 */
export function createSessionRecovery(options: SessionRecoveryOptions): {
  dispose: () => void;
  wake: () => void;
} {
  let disposed = false;
  let stopped = false;
  let generation = 0;
  let attempt = 0;
  let connected = false;
  let socket: WebSocket | undefined;
  let abort: AbortController | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  const target =
    options.onlineTarget ??
    (typeof window === 'undefined' ? undefined : window);
  const alive = (id: number) => !disposed && !stopped && id === generation;

  function clearAttempt() {
    generation++;
    connected = false;
    clearTimeout(retryTimer);
    clearTimeout(handshakeTimer);
    clearTimeout(stableTimer);
    abort?.abort();
    abort = undefined;
    const old = socket;
    socket = undefined;
    if (old) {
      old.onclose = null;
      old.onerror = null;
      old.onopen = null;
      old.onmessage = null;
      old.close();
      options.onSocket(undefined);
    }
  }
  function stop(kind?: RecoveryFailure['kind']) {
    if (disposed || stopped) return;
    stopped = true;
    clearAttempt();
    target?.removeEventListener('online', wake);
    options.onStatus('stopped');
    if (kind) options.onFatal({ kind, message: failures[kind] });
  }
  function retry(id: number) {
    if (!alive(id)) return;
    clearAttempt();
    const pending = generation;
    options.onStatus('reconnecting');
    const delay =
      recoveryTiming.backoff[
        Math.min(attempt++, recoveryTiming.backoff.length - 1)
      ];
    retryTimer = setTimeout(() => {
      if (alive(pending)) void start();
    }, delay);
  }
  function accept(snapshot: SessionSnapshot, id: number): boolean {
    if (!alive(id)) return false;
    let decision: 'continue' | 'stop';
    try {
      decision = options.onSnapshot(snapshot);
    } catch {
      stop('consumer');
      return false;
    }
    if (!alive(id)) return false;
    if (decision === 'stop') {
      stop();
      return false;
    }
    if (snapshot.status === 'failed') {
      stop('failed');
      return false;
    }
    if (snapshot.status === 'done' || snapshot.status === 'rendering') {
      stop();
      return false;
    }
    return true;
  }
  function handleError(error: unknown, id: number) {
    if (!alive(id)) return;
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? error.status
        : undefined;
    if (status === 401 || status === 403) stop('auth');
    else if (status === 404) stop('not-found');
    else if (status === 410) stop('expired');
    else retry(id);
  }
  function deliver(event: ServerEvent, id: number) {
    if (!alive(id)) return;
    try {
      const pending = options.onEvent(event);
      if (pending)
        return pending.catch(() => {
          if (alive(id)) stop('consumer');
        });
    } catch {
      stop('consumer');
    }
  }
  async function start() {
    if (disposed || stopped) return;
    clearAttempt();
    const id = generation;
    const controller = new AbortController();
    abort = controller;
    options.onStatus(attempt ? 'reconnecting' : 'restoring');
    try {
      let snapshot = await options.api.session(options.sessionId, {
        signal: controller.signal,
      });
      if (!accept(snapshot, id)) return;
      if (!snapshot.wsUrl) {
        stop('missing-url');
        return;
      }
      let ready = false;
      let reconciling = false;
      const buffer: ServerEvent[] = [];
      // Deadline includes hello and any REST reconciliation, not socket open.
      handshakeTimer = setTimeout(() => retry(id), recoveryTiming.handshake);
      async function hello(event: Extract<ServerEvent, { t: 'hello' }>) {
        reconciling = true;
        try {
          if (event.version !== snapshot.project.version) {
            const fresh = await options.api.session(options.sessionId, {
              signal: controller.signal,
            });
            if (!accept(fresh, id)) return;
            snapshot = fresh;
            // A lagging REST read cannot authorize dispatch against hello's head.
            if (snapshot.project.version < event.version) {
              retry(id);
              return;
            }
          }
          if (!alive(id)) return;
          await deliver(event, id);
          if (!alive(id)) return;
          // Snapshot already covers these project batches. Nonversioned packets
          // remain ordered; the backend has no agreed replay cursor for them.
          for (const packet of buffer) {
            if (
              packet.t === 'project.ops' &&
              packet.version <= snapshot.project.version
            )
              continue;
            await deliver(packet, id);
            if (!alive(id)) return;
          }
          buffer.length = 0;
          if (!alive(id)) return;
          ready = true;
          connected = true;
          clearTimeout(handshakeTimer);
          stableTimer = setTimeout(() => {
            if (alive(id) && connected) attempt = 0;
          }, recoveryTiming.stable);
          options.onStatus('connected');
        } catch (error) {
          handleError(error, id);
        }
      }
      const current = options.api.connect(
        snapshot.wsUrl,
        (event) => {
          if (!alive(id)) return;
          if (ready) {
            deliver(event, id);
            return;
          }
          if (event.t === 'hello' && !reconciling) {
            void hello(event);
          } else if (buffer.length < recoveryTiming.maxBufferedEvents) {
            buffer.push(event);
          } else retry(id);
        },
        () => retry(id),
      );
      if (!alive(id)) {
        current.close();
        return;
      }
      socket = current;
      options.onSocket(current);
      current.onerror = () => retry(id);
      // onopen intentionally does not reset backoff or authorize queue flush.
    } catch (error) {
      handleError(error, id);
    }
  }
  function wake() {
    if (!disposed && !stopped && !connected) void start();
  }
  target?.addEventListener('online', wake);
  void start();
  return {
    wake,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearAttempt();
      target?.removeEventListener('online', wake);
    },
  };
}
