// @vitest-environment node
import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { mockEnvironment, supervise } from '../../../scripts/dev-mock.mjs';
describe('mock supervisor with injected processes only', () => {
  it('forces local demo routes and removes credential-bearing inherited values', () => {
    const env = mockEnvironment({
      PATH: '/tools',
      KIMO_API_INTERNAL_URL: 'https://production',
      NEXT_PUBLIC_KIMO_API: 'https://production',
      ACCESS_TOKEN: 'secret',
      COOKIE: 'secret',
    });
    expect(env).toMatchObject({
      PATH: '/tools',
      NEXT_PUBLIC_KIMO_API: 'http://localhost:8787',
      NEXT_PUBLIC_KIMO_WS: 'ws://localhost:8787',
    });
    expect(env).not.toHaveProperty('COOKIE');
    expect(env).not.toHaveProperty('ACCESS_TOKEN');
    expect(env).not.toHaveProperty('KIMO_API_INTERNAL_URL');
  });
  it('starts web only after readiness then shuts down on child exit', async () => {
    const signals = new EventEmitter();
    const mock = new ChildProcess();
    const web = new ChildProcess();
    const calls: string[] = [];
    const available = vi.fn(async () => undefined);
    const start = vi.fn((_command: string, args: string[]) => {
      calls.push(args[1] ?? '');
      if (args[1] === '@kimo/web') {
        queueMicrotask(() => web.emit('exit', 0));
        return web;
      }
      return mock;
    });
    const request = vi.fn(async () => new Response('{"ok":true}'));
    expect(
      await supervise({
        start,
        available,
        request,
        signals,
        wait: async () => undefined,
        source: {},
        graceMs: 0,
      }),
    ).toBe(0);
    expect(calls).toEqual(['@kimo/mock-server', '@kimo/web']);
    expect(available.mock.calls).toHaveLength(2);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });
  it('does not launch web after bounded readiness failure', async () => {
    const child = new ChildProcess();
    const start = vi.fn(() => child);
    expect(
      await supervise({
        start,
        available: async () => undefined,
        request: async () => {
          throw new Error();
        },
        signals: new EventEmitter(),
        wait: async () => undefined,
        source: {},
        readinessAttempts: 2,
        graceMs: 0,
      }),
    ).toBe(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
