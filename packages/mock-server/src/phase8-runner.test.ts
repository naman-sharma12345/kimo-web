// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHeldRunner,
  createPausableTimers,
  type HeldStep,
} from './phase8-runner';
afterEach(() => vi.useRealTimers());
describe('Phase 8 synthetic scheduler epochs', () => {
  it('holds the current step, ACKs at safe end and supersedes stale queue', () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const step = (id: string): HeldStep => ({
      start: () => log.push(`start:${id}`),
      finish: () => log.push(`finish:${id}`),
      stop: () => log.push(`stop:${id}`),
    });
    const runner = createHeldRunner(200, 10);
    runner.enqueue([step('one'), step('stale')]);
    expect(log).toEqual(['start:one']);
    runner.afterCurrent(() => {
      log.push('ack');
      runner.enqueue([step('response')]);
    });
    vi.advanceTimersByTime(199);
    expect(log).toEqual(['start:one']);
    vi.advanceTimersByTime(1);
    expect(log).toEqual(['start:one', 'finish:one', 'ack', 'start:response']);
    vi.runAllTimers();
    expect(log).not.toContain('start:stale');
    expect(log.at(-1)).toBe('finish:response');
    runner.dispose();
  });
  it('pause cancels completion and all gap/boundary responses until explicit resume', () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const step = (id: string): HeldStep => ({
      start: () => log.push(`start:${id}`),
      finish: () => log.push(`finish:${id}`),
      stop: () => log.push(`stop:${id}`),
    });
    const runner = createHeldRunner(100, 10);
    runner.enqueue([step('one')]);
    runner.afterCurrent(() => {
      log.push('ack');
      runner.enqueue([step('response'), step('next')]);
    });
    runner.pause();
    runner.pause();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(['start:one', 'stop:one']);
    runner.resume();
    expect(log).toEqual(['start:one', 'stop:one', 'ack', 'start:response']);
    runner.pause();
    vi.runAllTimers();
    expect(log).not.toContain('finish:response');
    runner.resume();
    vi.runAllTimers();
    expect(log.at(-1)).toBe('finish:next');
    runner.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('freezes generic pending timers with remaining delay, and never polls while paused', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const clock = createPausableTimers();
    clock.schedule(100, fn);
    vi.advanceTimersByTime(40);
    clock.pause();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    clock.schedule(20, fn);
    clock.resume();
    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(40);
    expect(fn).toHaveBeenCalledTimes(2);
    clock.dispose();
    clock.schedule(1, fn);
    expect(vi.getTimerCount()).toBe(0);
  });
});
