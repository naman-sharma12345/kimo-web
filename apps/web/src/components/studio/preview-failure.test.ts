import { describe, expect, it } from 'vitest';
import { previewFailure } from './preview-failure';
describe('bounded safe preview exceptions', () => {
  it('preserves nested aggregate errors and causes without stacks, URLs, or credential fields', () => {
    const failure = previewFailure(
      new AggregateError(
        [
          new Error('No available renderer'),
          new Error('fallback failed', {
            cause: new Error(
              'token=secret123 https://example.com/private?secret=value',
            ),
          }),
        ],
        'init failed',
      ),
    );
    expect(failure.status).toBe('unavailable');
    expect(failure.details).toContain('fallback failed');
    expect(failure.details).toContain('token=[redacted]');
    expect(failure.details).not.toContain('secret123');
    expect(failure.details).not.toContain('https://');
    expect(failure.details).not.toContain(' at ');
    const protectedMessage = previewFailure(
      new Error('authorization=Bearer abc123 {"token":"hidden456"}'),
    );
    expect(protectedMessage.details).not.toContain('abc123');
    expect(protectedMessage.details).not.toContain('hidden456');
  });
  it('bounds cycles, depth, lines, and strings and distinguishes other init failures', () => {
    const error = new Error('device init rejected ' + 'x'.repeat(1000));
    error.cause = error;
    const result = previewFailure(
      new AggregateError(Array(100).fill(error), 'failed'),
    );
    expect(result.details.length).toBeLessThan(500);
    expect(result.status).toBe('error');
    expect(
      previewFailure({ secret: 'never serialize arbitrary objects' }).details,
    ).not.toContain('serialize');
  });
});
