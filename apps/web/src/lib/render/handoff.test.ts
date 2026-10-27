import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumeRenderArrival,
  deliveryTransition,
  markRenderArrival,
  setRenderPoster,
  takeRenderPoster,
} from './handoff';
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
describe('transient poster and verified completion handoff', () => {
  it('consumes a single in-memory poster and never stores blob URLs', () => {
    const blob = new Blob(['poster']);
    setRenderPoster('s', blob);
    expect(takeRenderPoster('s')).toBe(blob);
    expect(takeRenderPoster('s')).toBeUndefined();
    setRenderPoster('old', blob);
    setRenderPoster('new', blob);
    expect(takeRenderPoster('old')).toBeUndefined();
  });
  it('consumes arrival once, does not trigger for direct links, tolerates denied storage', () => {
    expect(consumeRenderArrival('direct')).toBe(false);
    markRenderArrival('done');
    expect(consumeRenderArrival('done')).toBe(true);
    expect(consumeRenderArrival('done')).toBe(false);
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw Error('denied');
      },
      setItem: () => {
        throw Error('denied');
      },
    });
    expect(() => markRenderArrival('done')).not.toThrow();
    expect(consumeRenderArrival('done')).toBe(false);
  });
  it('feature detects native transitions, routes once even repeated callback and ignores finished rejection', async () => {
    const navigate = vi.fn();
    const start = vi.fn((callback: () => void) => {
      callback();
      callback();
      return { finished: Promise.reject(Error('animation skipped')) };
    });
    vi.stubGlobal('document', { startViewTransition: start });
    deliveryTransition(navigate, false);
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledOnce();
    deliveryTransition(navigate, true);
    expect(start).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledTimes(2);
  });
});
