import * as React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WarmupScreen } from './warmup-screen';
import { warmupTiming } from './state';
const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), prefetch: vi.fn() },
  reduced: false,
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
      project: {},
      wsUrl: 'ws://test',
    })),
    connect: vi.fn(() => ({ close: vi.fn(), readyState: 1, onopen: null })),
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
  return view;
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
describe('warmup navigation safety', () => {
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
