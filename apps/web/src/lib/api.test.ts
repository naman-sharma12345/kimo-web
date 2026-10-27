import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
afterEach(() => vi.unstubAllEnvs());
describe('browser API facade', () => {
  it('is lazy and ignores private transport even on the server', () => {
    vi.stubEnv('KIMO_API_INTERNAL_URL', 'http://127.0.0.1:8790');
    vi.stubEnv('NEXT_PUBLIC_KIMO_API', 'https://preview.example/mock-api');
    expect(api.base).toBe('https://preview.example/mock-api');
  });
  it('fails on use without production configuration', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_KIMO_API', undefined);
    expect(() => api.base).toThrow('NEXT_PUBLIC_KIMO_API');
  });
});
