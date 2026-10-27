import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KimoProject, ServerEvent, SessionSnapshot } from '@kimo/client';
import { createSessionRecovery, recoveryTiming } from './session-recovery';

const project: KimoProject = {
  id: 'p',
  version: 0,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 8,
  tracks: [],
  clips: {},
  markers: [],
};
function snapshot(
  version = 0,
  wsUrl = `ws://test/${version}`,
): SessionSnapshot {
  return {
    status: 'editing',
    project: { ...project, version },
    assets: [],
    wsUrl,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing expected test value');
  return value;
}
function harness() {
  const sockets: Array<{
    socket: WebSocket;
    event: (event: ServerEvent) => void;
    close: () => void;
  }> = [];
  const order: string[] = [];
  const session = vi.fn(
    async (_id: string, _options?: { signal?: AbortSignal }) => {
      void _id;
      void _options;
      order.push('get');
      return snapshot();
    },
  );
  const connect = vi.fn(
    (url: string, event: (event: ServerEvent) => void, close?: () => void) => {
      order.push(url);
      const socket = {
        close: vi.fn(),
        onclose: close,
        onerror: null,
        onopen: null,
        onmessage: null,
      } as unknown as WebSocket;
      sockets.push({ socket, event, close: close ?? (() => {}) });
      return socket;
    },
  );
  const onSnapshot = vi.fn(
    (_snapshot: SessionSnapshot): 'continue' | 'stop' => {
      void _snapshot;
      return 'continue';
    },
  );
  const onEvent = vi.fn<(event: ServerEvent) => void | Promise<void>>();
  const onStatus = vi.fn();
  const onSocket = vi.fn();
  const onFatal = vi.fn();
  const onlineTarget = new EventTarget();
  const options = {
    sessionId: 's',
    api: { session, connect },
    onSnapshot,
    onEvent,
    onStatus,
    onSocket,
    onFatal,
    onlineTarget,
  };
  return { ...options, options, sockets, order, session, connect };
}
const owners: Array<ReturnType<typeof createSessionRecovery>> = [];
function start(h: ReturnType<typeof harness>) {
  const owner = createSessionRecovery(h.options);
  owners.push(owner);
  return owner;
}
async function tick(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  owners.splice(0).forEach((owner) => owner.dispose());
  vi.useRealTimers();
});
describe('single-owner session recovery', () => {
  it('GETs before every attach and consumes rotated URLs without connecting stored tokens', async () => {
    const h = harness();
    h.session
      .mockResolvedValueOnce(snapshot(0, 'ws://fresh/one'))
      .mockResolvedValueOnce(snapshot(1, 'ws://fresh/two'));
    start(h);
    expect(h.connect).not.toHaveBeenCalled();
    await tick();
    expect(h.order).toEqual(['ws://fresh/one']);
    expect(h.onSnapshot).toHaveBeenCalledBefore(h.connect);
    required(h.sockets[0]).close();
    await tick(1000);
    expect(h.session).toHaveBeenCalledTimes(2);
    expect(h.connect.mock.calls.map(([url]) => url)).toEqual([
      'ws://fresh/one',
      'ws://fresh/two',
    ]);
    expect(required(h.sockets[0]).socket.close).toHaveBeenCalledTimes(1);
  });
  it('keeps retrying at 1/2/4/8/15/15 seconds and makes close/error idempotent', async () => {
    const h = harness();
    start(h);
    await tick();
    for (const [index, delay] of [
      1000, 2000, 4000, 8000, 15000, 15000, 15000,
    ].entries()) {
      const current = required(h.sockets[index]);
      const error = current.socket.onerror;
      current.close();
      error?.call(current.socket, new Event('error'));
      current.close();
      await tick(delay - 1);
      expect(h.connect).toHaveBeenCalledTimes(index + 1);
      await tick(1);
      expect(h.connect).toHaveBeenCalledTimes(index + 2);
    }
  });
  it('does not use onopen as readiness or reset backoff on immediate hello-close cycles', async () => {
    const h = harness();
    start(h);
    await tick();
    required(h.sockets[0]).socket.onopen?.call(
      required(h.sockets[0]).socket,
      new Event('open'),
    );
    expect(h.onStatus).not.toHaveBeenCalledWith('connected');
    required(h.sockets[0]).event({ t: 'hello', version: 0 });
    required(h.sockets[0]).close();
    await tick(1000);
    required(h.sockets[1]).event({ t: 'hello', version: 0 });
    required(h.sockets[1]).close();
    await tick(1000);
    expect(h.connect).toHaveBeenCalledTimes(2);
    await tick(1000);
    expect(h.connect).toHaveBeenCalledTimes(3);
  });
  it('resets backoff only after a stable ready connection', async () => {
    const h = harness();
    start(h);
    await tick();
    required(h.sockets[0]).close();
    await tick(1000);
    required(h.sockets[1]).event({ t: 'hello', version: 0 });
    await tick(recoveryTiming.stable);
    required(h.sockets[1]).close();
    await tick(1000);
    expect(h.connect).toHaveBeenCalledTimes(3);
  });
  it('reconciles the GET-to-hello gap and buffers ordered events before connected/flush', async () => {
    const h = harness();
    const fresh = deferred<SessionSnapshot>();
    h.session
      .mockResolvedValueOnce(snapshot(0))
      .mockImplementationOnce(() => fresh.promise);
    const pendingIntent = [{ status: 'unknown', id: 'intent' }];
    const flush = vi.fn();
    h.onStatus.mockImplementation((status) => {
      if (
        status === 'connected' &&
        pendingIntent.every((intent) => intent.status === 'unsent')
      )
        flush();
    });
    start(h);
    await tick();
    const current = required(h.sockets[0]);
    current.event({ t: 'hello', version: 2 });
    current.event({ t: 'project.ops', version: 1, ops: [] });
    current.event({ t: 'agent.status', state: 'idle', label: 'ready' });
    current.event({ t: 'project.ops', version: 3, ops: [] });
    expect(h.onStatus).not.toHaveBeenCalledWith('connected');
    expect(h.onEvent).not.toHaveBeenCalled();
    fresh.resolve(snapshot(2));
    await tick();
    expect(h.onSnapshot).toHaveBeenCalledTimes(2);
    expect(h.onEvent.mock.calls.map(([event]) => event.t)).toEqual([
      'hello',
      'agent.status',
      'project.ops',
    ]);
    expect(h.onEvent.mock.invocationCallOrder.at(-1)).toBeLessThan(
      required(h.onStatus.mock.invocationCallOrder.at(-1)),
    );
    expect(h.onStatus).toHaveBeenLastCalledWith('connected');
    expect(flush).not.toHaveBeenCalled();
    expect(pendingIntent).toEqual([{ status: 'unknown', id: 'intent' }]);
    expect(h.connect).toHaveBeenCalledTimes(1);
  });
  it('awaits the existing asynchronous packet processor before authorizing a flush', async () => {
    const h = harness();
    const processing = deferred<undefined>();
    h.onEvent.mockImplementation((event) =>
      event.t === 'project.ops' ? processing.promise : undefined,
    );
    start(h);
    await tick();
    const current = required(h.sockets[0]);
    current.event({ t: 'project.ops', version: 1, ops: [] });
    current.event({ t: 'hello', version: 0 });
    await tick();
    expect(h.onStatus).not.toHaveBeenCalledWith('connected');
    processing.resolve(undefined);
    await tick();
    expect(h.onStatus).toHaveBeenLastCalledWith('connected');
  });
  it('stops on an asynchronous packet consumer failure without unhandled rejection', async () => {
    const h = harness();
    h.onEvent.mockRejectedValue(new Error('private consumer detail'));
    start(h);
    await tick();
    required(h.sockets[0]).event({ t: 'hello', version: 0 });
    await tick(60000);
    expect(h.onStatus).not.toHaveBeenCalledWith('connected');
    expect(h.onFatal).toHaveBeenCalledWith({
      kind: 'consumer',
      message: 'couldn’t restore this session safely.',
    });
    expect(h.connect).toHaveBeenCalledTimes(1);
  });
  it('fences pending asynchronous packet completion after disposal', async () => {
    const h = harness();
    const processing = deferred<undefined>();
    h.onEvent.mockReturnValue(processing.promise);
    const owner = start(h);
    await tick();
    required(h.sockets[0]).event({ t: 'hello', version: 0 });
    owner.dispose();
    processing.resolve(undefined);
    await tick(60000);
    expect(h.onStatus).not.toHaveBeenCalledWith('connected');
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.onSocket).toHaveBeenLastCalledWith(undefined);
  });
  it('backs off transient GET failures and never attaches before a successful restore', async () => {
    const h = harness();
    h.session
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 500 });
    start(h);
    await tick(1000);
    expect(h.session).toHaveBeenCalledTimes(2);
    expect(h.connect).not.toHaveBeenCalled();
    await tick(1999);
    expect(h.connect).not.toHaveBeenCalled();
    await tick(1);
    expect(h.session).toHaveBeenCalledTimes(3);
    expect(h.connect).toHaveBeenCalledTimes(1);
  });
  it('does not authorize readiness when REST is behind hello', async () => {
    const h = harness();
    start(h);
    await tick();
    required(h.sockets[0]).event({ t: 'hello', version: 3 });
    await tick();
    expect(h.onStatus).not.toHaveBeenCalledWith('connected');
    await tick(1000);
    expect(h.connect).toHaveBeenCalledTimes(2);
  });
  it('bounds handshake including reconciliation, even when open', async () => {
    const h = harness();
    const pending = deferred<SessionSnapshot>();
    h.session
      .mockResolvedValueOnce(snapshot())
      .mockImplementationOnce(() => pending.promise);
    start(h);
    await tick();
    required(h.sockets[0]).event({ t: 'hello', version: 1 });
    await tick(5000);
    expect(required(h.sockets[0]).socket.close).toHaveBeenCalledTimes(1);
    pending.resolve(snapshot(1));
    await tick();
    expect(h.onStatus).not.toHaveBeenCalledWith('connected');
    await tick(1000);
    expect(h.connect).toHaveBeenCalledTimes(2);
  });
  it('bounds pre-hello buffering rather than flushing without authority', async () => {
    const h = harness();
    start(h);
    await tick();
    for (let i = 0; i <= recoveryTiming.maxBufferedEvents; i++)
      required(h.sockets[0]).event({
        t: 'agent.status',
        state: 'idle',
        label: 'buffer',
      });
    expect(required(h.sockets[0]).socket.close).toHaveBeenCalledTimes(1);
    expect(h.onEvent).not.toHaveBeenCalled();
    await tick(1000);
    expect(h.connect).toHaveBeenCalledTimes(2);
  });
  it('online wake invalidates pending timers and pending GET without overlapping sockets', async () => {
    const h = harness();
    start(h);
    await tick();
    required(h.sockets[0]).close();
    const pending = deferred<SessionSnapshot>();
    h.session.mockImplementationOnce(() => pending.promise);
    h.onlineTarget.dispatchEvent(new Event('online'));
    await tick();
    const signal = h.session.mock.calls.at(-1)?.[1]?.signal;
    h.onlineTarget.dispatchEvent(new Event('online'));
    await tick();
    expect(signal?.aborted).toBe(true);
    expect(h.connect).toHaveBeenCalledTimes(2);
    pending.resolve(snapshot(99));
    await tick(1000);
    expect(h.connect).toHaveBeenCalledTimes(2);
    required(h.sockets[0]).event({ t: 'hello', version: 99 });
    expect(h.onEvent).not.toHaveBeenCalled();
    required(h.sockets[1]).event({ t: 'hello', version: 0 });
    await tick();
    h.onlineTarget.dispatchEvent(new Event('online'));
    await tick();
    expect(h.connect).toHaveBeenCalledTimes(2);
  });
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not-found'],
    [410, 'expired'],
  ] as const)(
    'stops on REST %s with bounded distinct failure %s',
    async (status, kind) => {
      const h = harness();
      h.session.mockRejectedValue({ status, message: 'secret token' });
      start(h);
      await tick(60000);
      expect(h.session).toHaveBeenCalledTimes(1);
      expect(h.onFatal).toHaveBeenCalledWith({
        kind,
        message: expect.not.stringContaining('secret'),
      });
      h.onlineTarget.dispatchEvent(new Event('online'));
      await tick();
      expect(h.session).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['failed', 'rendering', 'done'] as const)(
    'does not attach terminal %s snapshot',
    async (status) => {
      const h = harness();
      h.session.mockResolvedValue({ ...snapshot(), status });
      start(h);
      await tick(60000);
      expect(h.connect).not.toHaveBeenCalled();
      expect(h.onStatus).toHaveBeenLastCalledWith('stopped');
      if (status === 'failed')
        expect(h.onFatal).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'failed' }),
        );
    },
  );
  it('obeys snapshot stop and rejects missing URLs without stale fallback', async () => {
    const h = harness();
    h.onSnapshot.mockReturnValue('stop');
    start(h);
    await tick();
    expect(h.connect).not.toHaveBeenCalled();
    const missing = harness();
    missing.session.mockResolvedValue({ ...snapshot(), wsUrl: undefined });
    start(missing);
    await tick();
    expect(missing.onFatal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'missing-url' }),
    );
  });
  it('aborts on disposal and survives StrictMode setup/cleanup/setup with late fetches fenced', async () => {
    const h = harness();
    const late = deferred<SessionSnapshot>();
    h.session.mockImplementationOnce(() => late.promise);
    const first = start(h);
    const signal = h.session.mock.calls[0]?.[1]?.signal;
    first.dispose();
    first.dispose();
    expect(signal?.aborted).toBe(true);
    const second = start(h);
    await tick();
    late.resolve(snapshot(99));
    await tick();
    expect(h.connect).toHaveBeenCalledTimes(1);
    const current = required(h.sockets[0]);
    second.dispose();
    current.event({ t: 'hello', version: 0 });
    current.close();
    h.onlineTarget.dispatchEvent(new Event('online'));
    await tick(60000);
    expect(h.onEvent).not.toHaveBeenCalled();
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(current.socket.close).toHaveBeenCalledTimes(1);
    expect(h.onSocket).toHaveBeenLastCalledWith(undefined);
  });
});
