import { afterEach, expect, it, vi } from 'vitest';
import {
  createLogger,
  logger,
  DIAGNOSTIC_CODES,
  type DiagnosticCode,
  type DiagnosticContext,
} from './logger';
afterEach(() => vi.restoreAllMocks());
it('is silent for all production methods and does not inspect unsafe input', () => {
  const methods = ['debug', 'info', 'warn', 'error'] as const;
  const spies = methods.map((level) => vi.spyOn(console, level));
  const sink = vi.fn();
  const prod = createLogger({ production: true }, sink);
  const hostile = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('private');
      },
    },
  );
  for (const level of methods) {
    prod[level]('unexpected_error', hostile);
    logger[level]('unexpected_error');
  }
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  expect(sink).not.toHaveBeenCalled();
});
it('development logger forwards only fixed code and reconstructed enums/counts', () => {
  const sink = vi.fn();
  const dev = createLogger({ production: false }, sink);
  for (const code of DIAGNOSTIC_CODES)
    dev.info(code, { count: 1, category: 'network' });
  expect(sink).toHaveBeenCalledTimes(DIAGNOSTIC_CODES.length);
  expect(sink.mock.calls[0]).toEqual([
    'info',
    'upload_failed',
    { count: 1, category: 'network' },
  ]);
});
it('rejects raw messages/errors/URLs/IDs and invalid numeric or categorical data', () => {
  const sink = vi.fn();
  const dev = createLogger({ production: false }, sink);
  dev.error('private prompt' as DiagnosticCode);
  for (const context of [
    { message: 'private prompt Alice file.mov' },
    new Error('private'),
    { category: 'https://signed.test/?token=secret' },
    { count: Infinity },
    { count: -1 },
    { count: 0.1 },
    { count: 1000001 },
    { count: 1, sessionId: 'secret' },
  ])
    dev.warn('unexpected_error', context as DiagnosticContext);
  expect(sink).not.toHaveBeenCalled();
});
it('development console receives only allowlisted fields and never throws on sink failure', () => {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  createLogger({ production: false }).warn('restore_failed', {
    category: 'restore',
  });
  expect(spy).toHaveBeenCalledWith('restore_failed', { category: 'restore' });
  expect(() =>
    createLogger({ production: false }, () => {
      throw new Error('private');
    }).info('connection_closed'),
  ).not.toThrow();
});
