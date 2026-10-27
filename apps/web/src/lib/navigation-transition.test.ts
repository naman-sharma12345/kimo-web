import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationTransition } from './navigation-transition';
import { durations } from './motion';
import { warmupTiming } from '@/components/warmup/state';

const bound = durations.d3 * 1000;
const original = Object.getOwnPropertyDescriptor(
  document,
  'startViewTransition',
);
let callback: () => void;
let rejectReady: (reason?: unknown) => void;
let rejectUpdate: (reason?: unknown) => void;
let rejectFinished: (reason?: unknown) => void;
const native = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  native.mockReset().mockImplementation((update: () => void) => {
    callback = update;
    return {
      ready: new Promise<void>((_, reject) => {
        rejectReady = reject;
      }),
      updateCallbackDone: new Promise<void>((_, reject) => {
        rejectUpdate = reject;
      }),
      finished: new Promise<void>((_, reject) => {
        rejectFinished = reject;
      }),
    };
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

describe('cosmetic navigation transition', () => {
  it('reuses the existing warmup crossfade duration', () => {
    expect(bound).toBe(warmupTiming.crossfade);
  });
  it('navigates at the bound if native never invokes the callback', () => {
    const navigate = vi.fn();
    navigationTransition(navigate);
    vi.advanceTimersByTime(bound - 1);
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    callback();
    callback();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
  it('normal native callback navigates once and clears the fallback', () => {
    const navigate = vi.fn();
    navigationTransition(navigate);
    callback();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(bound);
    callback();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
  it('handles a synchronous native callback', () => {
    native.mockImplementationOnce((update: () => void) => {
      update();
      return {
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        finished: Promise.resolve(),
      };
    });
    const navigate = vi.fn();
    navigationTransition(navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('falls back immediately if native throws', () => {
    native.mockImplementationOnce(() => {
      throw new Error('native failure');
    });
    const navigate = vi.fn();
    navigationTransition(navigate);
    vi.advanceTimersByTime(bound);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
  it.each(['ready', 'update', 'finished'] as const)(
    'falls back on %s rejection without duplicating navigation',
    async (phase) => {
      const navigate = vi.fn();
      navigationTransition(navigate);
      const reject = {
        ready: rejectReady,
        update: rejectUpdate,
        finished: rejectFinished,
      }[phase];
      reject(new Error('native rejection'));
      await Promise.resolve();
      expect(navigate).toHaveBeenCalledTimes(1);
      callback();
      rejectReady();
      rejectUpdate();
      rejectFinished();
      await Promise.resolve();
      vi.advanceTimersByTime(bound);
      expect(navigate).toHaveBeenCalledTimes(1);
    },
  );
  it.each([false, true])(
    'navigates directly without animation (reduced=%s)',
    (reduced) => {
      if (!reduced) Reflect.deleteProperty(document, 'startViewTransition');
      const navigate = vi.fn();
      navigationTransition(navigate, reduced);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(native).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('cleanup cancels the fallback and ignores late callbacks and rejection', async () => {
    const navigate = vi.fn();
    const cancel = navigationTransition(navigate);
    cancel();
    cancel();
    expect(vi.getTimerCount()).toBe(0);
    callback();
    rejectReady();
    await Promise.resolve();
    vi.advanceTimersByTime(bound);
    expect(navigate).not.toHaveBeenCalled();
  });
});
