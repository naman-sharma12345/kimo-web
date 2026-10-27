import { afterEach, expect, it, vi } from 'vitest';
import type { SafeTransport } from './telemetry';
import {
  createErrorReporter,
  ERROR_BOUNDARIES,
  ERROR_CATEGORIES,
  type ErrorContext,
} from './error-reporting';
const config = { endpoint: 'https://collector.example.test/errors' };
const context = { boundary: 'studio', category: 'restore' } as const;
const secret =
  'Alice private prompt file.mov session123 https://media.test/x?token=secret';
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('builds Sentry-compatible fixed message/class/tags without raw error fields', () => {
  const send = vi.fn();
  const reporter = createErrorReporter(config, send);
  const error = new TypeError(secret, { cause: new Error(secret) });
  error.stack = secret;
  Object.assign(error, { digest: secret, name: secret, user: secret });
  reporter.report(error, context);
  expect(send.mock.calls[0]?.[0]).toEqual({
    level: 'error',
    message: 'Session restore failed',
    exception: {
      values: [{ type: 'TypeError', value: 'Session restore failed' }],
    },
    tags: context,
  });
  expect(JSON.stringify(send.mock.calls)).not.toContain(secret);
});
it('never reads getters or sends throw content, stack, causes or AggregateError text', async () => {
  const send = vi.fn();
  const reporter = createErrorReporter(config, send);
  const getter = vi.fn(() => {
    throw new Error(secret);
  });
  const error = new Error();
  for (const field of ['name', 'message', 'stack', 'cause'])
    Object.defineProperty(error, field, { get: getter });
  for (const value of [
    error,
    secret,
    { message: secret },
    new AggregateError([new Error(secret)], secret),
    new RangeError(secret),
    null,
  ]) {
    expect(() => reporter.report(value, context)).not.toThrow();
    await Promise.resolve();
  }
  expect(getter).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(6);
  expect(JSON.stringify(send.mock.calls)).not.toContain(secret);
});
it('gates missing/unsafe/disabled config, rejects invalid context and hostile objects', () => {
  vi.useFakeTimers();
  const send = vi.fn();
  for (const config of [
    undefined,
    {},
    { endpoint: 'http://x.test' },
    { endpoint: 'https://x.test?token=secret' },
    { endpoint: 'https://x.test', enabled: false },
  ])
    createErrorReporter(config, send).report(new Error(secret), context);
  const reporter = createErrorReporter({ endpoint: 'https://x.test' }, send);
  const unsafe = [
    { ...context, sessionId: secret },
    { ...context, boundary: secret },
    { ...context, category: secret },
    new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(secret);
        },
      },
    ),
  ];
  for (const value of unsafe)
    expect(() =>
      reporter.report(new Error(secret), value as ErrorContext),
    ).not.toThrow();
  expect(send).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('supports static boundary/category enums and deduplicates repeated Error objects', async () => {
  const send = vi.fn();
  const reporter = createErrorReporter(config, send);
  const error = new Error(secret);
  reporter.report(error, context);
  await Promise.resolve();
  reporter.report(error, context);
  for (const boundary of ERROR_BOUNDARIES) {
    reporter.report({}, { boundary, category: 'unknown' });
    await Promise.resolve();
  }
  expect(send).toHaveBeenCalledTimes(8);
  for (const category of ERROR_CATEGORIES) {
    const sink = vi.fn();
    createErrorReporter(config, sink).report(
      {},
      { boundary: 'global', category },
    );
    expect(sink).toHaveBeenCalledOnce();
  }
});
it('bounds single in-flight, timeouts and ten-per-minute; never retries or recursively logs', async () => {
  vi.useFakeTimers();
  const consoleError = vi.spyOn(console, 'error');
  const sink = vi.fn<SafeTransport>(() => new Promise<void>(() => undefined));
  const reporter = createErrorReporter(config, sink);
  for (let n = 0; n < 12; n++) reporter.report({}, context);
  expect(sink).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3000);
  expect(sink.mock.calls[0]?.[1].signal.aborted).toBe(true);
  for (let n = 0; n < 10; n++) {
    reporter.report({}, context);
    await vi.advanceTimersByTimeAsync(3000);
  }
  expect(sink).toHaveBeenCalledTimes(10);
  expect(consoleError).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60000);
  reporter.report({}, context);
  expect(sink).toHaveBeenCalledTimes(11);
});
it('transport failures never escape/report or expose source error', async () => {
  const log = vi.spyOn(console, 'error');
  expect(() =>
    createErrorReporter(config, () => {
      throw new Error(secret);
    }).report(new Error(secret), context),
  ).not.toThrow();
  createErrorReporter(config, () => Promise.reject(new Error(secret))).report(
    new Error(secret),
    context,
  );
  await Promise.resolve();
  expect(log).not.toHaveBeenCalled();
});
