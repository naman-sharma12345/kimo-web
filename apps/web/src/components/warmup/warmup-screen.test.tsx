import * as React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WarmupScreen } from './warmup-screen';
import { warmupTiming } from './state';
import { api } from '@/lib/api';
import type { ServerEvent } from '@kimo/client';
const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), prefetch: vi.fn() },
  reduced: false,
  close: undefined as (() => void) | undefined,
  event: undefined as
    ((event: import('@kimo/client').ServerEvent) => void) | undefined,
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('motion/react', () => ({ useReducedMotion: () => mocks.reduced }));
vi.mock('./warmup-reel', () => ({ WarmupReel: () => null }));
vi.mock('@kimo/compositor', () => ({ prefetchVideos: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: {
    session: vi.fn(async () => ({
      status: 'editing',
      assets: [],
      project: { version: 0 },
      wsUrl: 'ws://test',
    })),
    connect: vi.fn(
      (
        _url: string,
        event: (packet: ServerEvent) => void,
        close?: () => void,
      ) => {
        mocks.event = event;
        mocks.close = close;
        return { close: vi.fn(), readyState: 1, onopen: null };
      },
    ),
  },
}));
vi.mock('@/stores/project', () => ({
  useProject: { getState: () => ({ replace: vi.fn() }) },
}));
vi.mock('@/stores/session', () => ({
  useSession: { getState: () => ({ restore: () => undefined }) },
}));
vi.mock('@/lib/uploads', () => ({
  useUploads: (selector: (state: { items: never[] }) => unknown) =>
    selector({ items: [] }),
}));
const original = Object.getOwnPropertyDescriptor(
  document,
  'startViewTransition',
);
let callback: () => void;
const native = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.reduced = false;
  native.mockImplementation((update: () => void) => {
    callback = update;
    const pending = new Promise<void>(() => {});
    return { ready: pending, updateCallbackDone: pending, finished: pending };
  });
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: native,
  });
});
afterEach(() => {
  vi.useRealTimers();
  if (original)
    Object.defineProperty(document, 'startViewTransition', original);
  else Reflect.deleteProperty(document, 'startViewTransition');
});
async function ready() {
  const view = render(<WarmupScreen sessionId="session/id" />);
  await act(async () => {});
  await act(async () => {
    mocks.event?.({ t: 'hello', version: 0 });
  });
  return view;
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
describe('warmup navigation safety', () => {
  it('waits for authoritative GET and hello before entering the studio', async () => {
    const view = render(<WarmupScreen sessionId="session/id" />);
    expect(api.connect).not.toHaveBeenCalled();
    await act(async () => {});
    expect(api.session).toHaveBeenCalledBefore(vi.mocked(api.connect));
    expect(mocks.router.prefetch).not.toHaveBeenCalled();
    await act(async () => {
      mocks.event?.({ t: 'hello', version: 0 });
    });
    expect(mocks.router.prefetch).toHaveBeenCalledWith('/studio/session%2Fid');
    view.unmount();
  });
  it('cancels a pending unfold on drop and waits for the next authoritative handshake', async () => {
    const view = await ready();
    await advance(warmupTiming.beat);
    expect(view.container.querySelector('main')).toHaveAttribute(
      'data-unfolding',
      'true',
    );
    await act(async () => {
      mocks.close?.();
    });
    expect(view.container.querySelector('main')).not.toHaveAttribute(
      'data-unfolding',
    );
    await advance(1000 + warmupTiming.unfold + warmupTiming.crossfade);
    expect(api.session).toHaveBeenCalledTimes(2);
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
    await act(async () => {
      mocks.event?.({ t: 'hello', version: 0 });
    });
    await advance(
      warmupTiming.beat + warmupTiming.unfold + warmupTiming.crossfade,
    );
    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith(
      '/studio/session%2Fid',
    );
  });
  it('StrictMode effect replay does not attach the stale initial GET', async () => {
    const view = render(
      <React.StrictMode>
        <WarmupScreen sessionId="session/id" />
      </React.StrictMode>,
    );
    await act(async () => {});
    expect(api.session).toHaveBeenCalledTimes(2);
    expect(api.connect).toHaveBeenCalledTimes(1);
    const oldEvent = mocks.event;
    view.unmount();
    await act(async () => {
      oldEvent?.({ t: 'hello', version: 0 });
    });
    await advance(60000);
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });
  it.each([
    ['rendering', undefined, '/render/session%2Fid'],
    ['done', 'video/id', '/v/video%2Fid'],
  ] as const)(
    'routes known %s snapshots without opening a socket',
    async (status, videoId, route) => {
      vi.mocked(api.session).mockResolvedValueOnce({
        status,
        assets: [],
        project: {
          id: 'p',
          version: 0,
          fps: 30,
          width: 1920,
          height: 1080,
          duration: 0,
          tracks: [],
          clips: {},
          markers: [],
        },
        wsUrl: 'ws://unused',
        ...(videoId ? { videoId } : {}),
      });
      render(<WarmupScreen sessionId="session/id" />);
      await act(async () => {});
      expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith(route);
      expect(api.connect).not.toHaveBeenCalled();
    },
  );
  it('surfaces bounded auth failure without retrying or exposing response content', async () => {
    vi.mocked(api.session).mockRejectedValueOnce({
      status: 401,
      message: 'private token',
    });
    const view = render(<WarmupScreen sessionId="session/id" />);
    await act(async () => {});
    expect(
      view.getByText('sign in to reconnect to this session.'),
    ).toBeInTheDocument();
    await advance(60000);
    expect(api.session).toHaveBeenCalledTimes(1);
    expect(api.connect).not.toHaveBeenCalled();
  });
  it('preserves prefetch and the ready/unfold deadline, then replaces once at the fallback bound', async () => {
    const view = await ready();
    expect(mocks.router.prefetch).toHaveBeenCalledWith('/studio/session%2Fid');
    await advance(warmupTiming.beat);
    expect(view.container.querySelector('main')).toHaveAttribute(
      'data-unfolding',
      'true',
    );
    await advance(warmupTiming.unfold - 1);
    expect(native).not.toHaveBeenCalled();
    await advance(1);
    expect(native).toHaveBeenCalledTimes(1);
    expect(mocks.router.replace).not.toHaveBeenCalled();
    await advance(warmupTiming.crossfade);
    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith(
      '/studio/session%2Fid',
    );
    callback();
    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
  });
  it('cancels fallback and late native callback on unmount', async () => {
    const view = await ready();
    await advance(warmupTiming.beat + warmupTiming.unfold);
    view.unmount();
    await advance(warmupTiming.crossfade);
    callback();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });
  it('retains the existing reduced-motion delay but skips native animation', async () => {
    mocks.reduced = true;
    await ready();
    await advance(warmupTiming.crossfade);
    expect(native).not.toHaveBeenCalled();
    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith(
      '/studio/session%2Fid',
    );
  });
});
