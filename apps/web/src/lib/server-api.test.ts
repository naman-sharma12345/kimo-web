import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/headers', () => ({ headers: vi.fn() }));
import { createRequestApi, createServerApi } from './server-api';
import { headers } from 'next/headers';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const response = () =>
  new Response(
    JSON.stringify({
      status: 'editing',
      assets: [],
      project: {
        id: 'p',
        version: 0,
        fps: 30,
        width: 1920,
        height: 1080,
        duration: 0,
        tracks: [],
        clips: {},
        markers: [],
      },
    }),
  );
describe('request-scoped SSR credentials', () => {
  it('isolates concurrent requests and fails closed on cookie destinations', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response());
    const make = (cookie: string) =>
      createRequestApi({
        publicBase: 'https://api.test/prefix',
        cookieOrigin: 'https://api.test',
        cookie,
        request,
      });
    await Promise.all([
      make('session=one').session('a'),
      make('session=two').session('b'),
    ]);
    expect(
      request.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get('cookie'),
      ),
    ).toEqual(['session=one', 'session=two']);
    for (const [, init] of request.mock.calls)
      expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
    expect(() =>
      createRequestApi({
        publicBase: 'https://api.test',
        cookieOrigin: 'https://evil.test',
        cookie: 'secret',
        request,
      }),
    ).toThrow('KIMO_SSR_COOKIE_ORIGIN');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('never treats configured public/internal routes as cookie approval', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response());
    const client = createRequestApi({
      publicBase: 'https://api.test',
      internalBase: 'http://127.0.0.1:8790/prefix',
      production: true,
      cookie: 'secret',
      request,
    });
    await client.session('s');
    expect(request.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:8790/prefix/v1/sessions/s',
    );
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).has('cookie')).toBe(
      false,
    );
    expect(() =>
      createRequestApi({
        publicBase: 'https://api.test',
        internalBase: 'http://remote.test',
        production: true,
      }),
    ).toThrow();
  });
  it('rejects browser use of request context', async () => {
    await expect(createServerApi()).rejects.toThrow('server API context');
  });
  it('awaits request headers for each server factory invocation', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_KIMO_API', 'https://api.test/prefix');
    vi.stubEnv('NEXT_PUBLIC_KIMO_WS', 'wss://ws.test');
    vi.stubEnv('KIMO_API_INTERNAL_URL', undefined);
    vi.stubEnv('KIMO_SSR_COOKIE_ORIGIN', 'https://api.test');
    vi.mocked(headers)
      .mockResolvedValueOnce(new Headers({ cookie: 'session=first' }))
      .mockResolvedValueOnce(new Headers({ cookie: 'session=second' }));
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response());
    vi.stubGlobal('fetch', request);
    const first = await createServerApi();
    const second = await createServerApi();
    await Promise.all([first.session('a'), second.session('b')]);
    expect(
      request.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get('cookie'),
      ),
    ).toEqual(['session=first', 'session=second']);
  });
});
