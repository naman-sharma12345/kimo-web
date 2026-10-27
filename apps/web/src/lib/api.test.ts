import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ base: vi.fn() }));
vi.mock('@kimo/client', () => ({
  KimoClient: class {
    readonly base: string;
    constructor(base: string) {
      this.base = base;
      mocks.base(base);
    }
  },
}));
beforeEach(() => {
  vi.resetModules();
  mocks.base.mockClear();
  vi.stubEnv('KIMO_API_INTERNAL_URL', undefined);
  vi.stubEnv('NEXT_PUBLIC_KIMO_API', undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('typed API base selection', () => {
  it('uses the internal service route for SSR when explicitly configured', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubEnv('KIMO_API_INTERNAL_URL', 'http://127.0.0.1:8790');
    vi.stubEnv('NEXT_PUBLIC_KIMO_API', 'https://preview.example/mock-api');
    await import('./api');
    expect(mocks.base).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:8790');
  });
  it('never uses the internal service route in the browser', async () => {
    vi.stubEnv('KIMO_API_INTERNAL_URL', 'http://127.0.0.1:8790');
    vi.stubEnv('NEXT_PUBLIC_KIMO_API', 'https://preview.example/mock-api');
    await import('./api');
    expect(mocks.base).toHaveBeenCalledExactlyOnceWith(
      'https://preview.example/mock-api',
    );
  });
  it('preserves the public service route for SSR without an override', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubEnv('NEXT_PUBLIC_KIMO_API', 'https://api.example');
    await import('./api');
    expect(mocks.base).toHaveBeenCalledExactlyOnceWith('https://api.example');
  });
  it('preserves the original development default', async () => {
    await import('./api');
    expect(mocks.base).toHaveBeenCalledExactlyOnceWith('http://localhost:8787');
  });
});
