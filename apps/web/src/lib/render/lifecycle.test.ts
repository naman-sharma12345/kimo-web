import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Render, type SessionSnapshot } from '@kimo/client';
import {
  cancelToEditing,
  pollRender,
  renderedChunk,
  renderStage,
  reopenEditing,
  resolveSession,
  routeFailure,
  type RenderApi,
} from './lifecycle';
const value = (patch: Partial<Render> = {}): Render => ({
  status: 'rendering',
  progress: 0.2,
  frame: 48,
  totalFrames: 240,
  etaSec: 12,
  ...patch,
});
const api = (patch: Partial<RenderApi> = {}): RenderApi => ({
  render: vi.fn(async () => value()),
  session: vi.fn(
    async () => ({ status: 'editing' as const }) as SessionSnapshot,
  ),
  cancelRender: vi.fn(async () => ({
    status: 'cancelled' as const,
    sessionId: 'session',
  })),
  reopenSession: vi.fn(async () => ({ status: 'editing' as const })),
  renderFrameUrl: (id, frame) => `/${id}?n=${frame}`,
  ...patch,
});
afterEach(() => vi.useRealTimers());
describe('render lifecycle authority', () => {
  it('observes exact stage boundaries and chunk identity, not poll ticks', () => {
    expect([0, 0.849, 0.85, 0.95, 0.99, 1].map(renderStage)).toEqual([
      'composing frames',
      'composing frames',
      'mixing audio',
      'encoding 1080p',
      'finishing up',
      'finishing up',
    ]);
    expect(renderedChunk(value())).toBeUndefined();
    expect(renderedChunk(value({ fps: 30 }))).toBe(1);
    expect(renderedChunk(value({ fps: 30, chunkIndex: 7 }))).toBe(7);
  });
  it('uses actual renderId, never session/project id, and refuses missing identities', () => {
    expect(
      resolveSession({
        renderId: 'actual',
        status: 'rendering',
      } as SessionSnapshot),
    ).toEqual({ kind: 'job', renderId: 'actual' });
    expect(resolveSession({ status: 'rendering' } as SessionSnapshot)).toEqual({
      kind: 'unresolved',
    });
    expect(
      resolveSession({ status: 'done', videoId: 'video' } as SessionSnapshot),
    ).toEqual({ kind: 'video', videoId: 'video' });
  });
  it('does not overlap, schedules 800ms after response, stops terminal and aborts on disposal', async () => {
    vi.useFakeTimers();
    let release: (render: Render) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<Render>((resolve) => {
          release = resolve;
        }),
    );
    const observe = vi.fn();
    const stop = pollRender({ render: read }, 'actual-job', observe, vi.fn());
    await vi.advanceTimersByTimeAsync(2400);
    expect(read).toHaveBeenCalledTimes(1);
    release(value());
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(799);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    release(value({ status: 'done', videoId: 'actual-video' }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(8000);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
    expect(read).toHaveBeenCalledWith('actual-job', {
      signal: expect.any(AbortSignal),
    });
  });
  it('ignores late old-generation responses and never fabricates failure/progress on network error', async () => {
    vi.useFakeTimers();
    const observe = vi.fn();
    const unavailable = vi.fn();
    let release: (render: Render) => void = () => {};
    const stop = pollRender(
      {
        render: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      },
      'old',
      observe,
      unavailable,
    );
    stop();
    release(value());
    await Promise.resolve();
    expect(observe).not.toHaveBeenCalled();
    const cleanup = pollRender(
      {
        render: vi.fn(async () => {
          throw new Error('offline');
        }),
      },
      'job',
      observe,
      unavailable,
    );
    await Promise.resolve();
    expect(unavailable).toHaveBeenCalledOnce();
    expect(observe).not.toHaveBeenCalled();
    cleanup();
  });
  it('reconciles an unknown cancel by GET without replaying POST; handles done races', async () => {
    const client = api({
      cancelRender: vi.fn(async () => {
        throw new Error('lost response');
      }),
    });
    expect(await cancelToEditing(client, 'session', 'job')).toEqual({
      kind: 'editing',
    });
    expect(client.cancelRender).toHaveBeenCalledOnce();
    const raced = api({
      session: vi.fn(
        async () => ({ status: 'done', videoId: 'video' }) as SessionSnapshot,
      ),
    });
    expect(await cancelToEditing(raced, 'session', 'job')).toEqual({
      kind: 'done',
      videoId: 'video',
    });
  });
  it('keeps unknown cancel/reopen unresolved and expiry distinct', async () => {
    const client = api({
      cancelRender: vi.fn(async () => {
        throw Error('network');
      }),
      reopenSession: vi.fn(async () => {
        throw Error('network');
      }),
      session: vi.fn(async () => {
        throw Error('network');
      }),
    });
    expect(await cancelToEditing(client, 's', 'r')).toEqual({
      kind: 'unknown',
    });
    expect(await reopenEditing(client, 's')).toEqual({ kind: 'unknown' });
    const expired = api({
      reopenSession: vi.fn(async () => {
        throw new ApiError(410, 'expired');
      }),
    });
    await expect(reopenEditing(expired, 's')).rejects.toMatchObject({
      status: 410,
    });
    expect(routeFailure(new ApiError(404, 'missing'))).toBe('missing');
    expect(routeFailure(new ApiError(410, 'expired'))).toBe('expired');
    expect(routeFailure(Error('offline'))).toBe('unavailable');
  });
});
