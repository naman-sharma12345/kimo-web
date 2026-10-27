import { describe, expect, it, vi } from 'vitest';
import { KimoClient } from './client';
import { parseApiBase, parseWsOrigin, resolveSessionWsUrl } from './config';
describe('transport configuration', () => {
  it('preserves service prefix and raw session path/query with routing override', () => {
    expect(parseApiBase('https://edge.example/mock-api///')).toBe(
      'https://edge.example/mock-api',
    );
    expect(
      resolveSessionWsUrl(
        'ws://internal/live/a%2fb?token=a%2B&x=1&x=2',
        'wss://edge.example',
      ),
    ).toBe('wss://edge.example/live/a%2fb?token=a%2B&x=1&x=2');
    expect(
      resolveSessionWsUrl(
        'wss://edge.example?token=%20',
        'wss://route.example',
      ),
    ).toBe('wss://route.example?token=%20');
    expect(resolveSessionWsUrl('wss://edge.example/live?token=%20')).toBe(
      'wss://edge.example/live?token=%20',
    );
  });
  it('rejects ambiguous, secret-bearing and invalid configuration', () => {
    for (const value of [
      '',
      '/api',
      'ftp://edge.test',
      'https://u:p@edge.test',
      'https://edge.test?token=x',
      'https://edge.test#x',
      ' https://edge.test',
      'https://edge.test\\evil',
    ])
      expect(() => parseApiBase(value)).toThrow();
    for (const value of [
      'https://edge.test',
      'wss://edge.test/live',
      'wss://edge.test?token=x',
    ])
      expect(() => parseWsOrigin(value)).toThrow();
    for (const value of [
      '',
      '/live',
      'https://edge.test/live',
      'wss://u:p@edge.test/live',
      'wss://edge.test/live#x',
    ])
      expect(() => resolveSessionWsUrl(value)).toThrow();
    expect(() => parseApiBase('https://edge.test?token=secret')).toThrow(
      'NEXT_PUBLIC_KIMO_API',
    );
  });
  it('uses credentialed nonredirecting REST without changing signed media policy', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
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
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const client = new KimoClient('https://edge.test/api/', request);
    const signal = new AbortController().signal;
    await client.session('a/b', { signal });
    await client.message('a/b', 'text');
    expect(request.mock.calls[0]?.[0]).toBe(
      'https://edge.test/api/v1/sessions/a%2Fb',
    );
    for (const [, init] of request.mock.calls)
      expect(init).toMatchObject({ credentials: 'include', redirect: 'error' });
    expect(request.mock.calls[0]?.[1]?.signal).toBe(signal);
    expect(request.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      'Content-Type',
    );
  });
  it('uses configured WS origin and does not invent a missing session URL', () => {
    const socket = { onmessage: null, onclose: null };
    const ctor = vi.fn(function () {
      return socket;
    });
    vi.stubGlobal('WebSocket', ctor);
    try {
      const client = new KimoClient('https://api.test', undefined, {
        wsOrigin: 'wss://edge.test',
      });
      client.connect('ws://internal/live/s?token=x', () => undefined);
      expect(ctor).toHaveBeenCalledWith('wss://edge.test/live/s?token=x');
      expect(() => client.connect('', () => undefined)).toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
