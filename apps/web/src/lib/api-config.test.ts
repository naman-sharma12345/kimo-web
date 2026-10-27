import { describe, expect, it } from 'vitest';
import { resolvePublicApiConfig } from './api-config';
describe('public API configuration', () => {
  it('retains development default only outside production', () => {
    expect(
      resolvePublicApiConfig({ mode: 'test', api: undefined, ws: undefined })
        .apiBase,
    ).toBe('http://localhost:8787');
  });
  it('requires explicit secure production API and WS', () => {
    for (const [api, ws] of [
      [undefined, undefined],
      ['https://api.example', undefined],
      ['http://localhost:8787', 'wss://ws.example'],
      ['https://api.example', 'ws://ws.example'],
    ]) {
      expect(() =>
        resolvePublicApiConfig({ mode: 'production', api, ws }),
      ).toThrow();
    }
    expect(
      resolvePublicApiConfig({
        mode: 'production',
        api: 'https://api.example/prefix/',
        ws: 'wss://ws.example',
      }),
    ).toEqual({
      apiBase: 'https://api.example/prefix',
      wsOrigin: 'wss://ws.example',
    });
  });
});
