import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(`apps/web/src/${path}`, 'utf8');
describe('unknown-session and cancellation retention evidence', () => {
  it.each([
    'app/not-found.tsx',
    'app/studio/[sessionId]/not-found.tsx',
    'components/warmup/full-screen-error.tsx',
    'components/warmup/warmup-screen.tsx',
    'components/studio/top-bar.tsx',
  ])('does not promise a fixed storage lifetime in %s', (path) => {
    expect(read(path)).not.toMatch(
      /24 hours|24h|files stay uploaded|files are saved for/,
    );
  });
  it('keeps the requested production policy and its explicit unverified boundary', () => {
    const privacy = read('app/privacy/page.tsx');
    expect(privacy).toContain('24 hours');
    expect(privacy).toContain('30 days');
    expect(privacy).toContain('have not yet been verified');
  });
});
