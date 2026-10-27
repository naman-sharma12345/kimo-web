import { describe, expect, it } from 'vitest';
import { securityHeaders } from './security-headers';
const nonce = '0123456789abcdefghijklmn';
describe('closed security headers', () => {
  it('uses request nonce and only validated configured API/WS/media/telemetry origins', () => {
    const headers = securityHeaders(
      {
        production: true,
        api: 'https://api.example/prefix',
        ws: 'wss://socket.example',
        media: 'https://bucket.example',
        telemetry: 'https://metrics.example',
      },
      nonce,
    );
    const policy = headers['Content-Security-Policy'];
    expect(policy).toContain(`'nonce-${nonce}' 'strict-dynamic'`);
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain(
      "connect-src 'self' https://api.example wss://socket.example https://bucket.example https://metrics.example",
    );
    expect(policy).not.toContain('*');
    expect(policy).toContain("font-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(headers['Permissions-Policy']).toContain('microphone=()');
    expect(headers).not.toHaveProperty('Cross-Origin-Embedder-Policy');
  });
  it.each([
    'https://u:p@bucket.example',
    'https://bucket.example/path',
    'https://bucket.example?token=x',
    'http://bucket.example',
    'data:text/plain,x',
    '*',
    'https://bucket.example\r\nx-bad:yes',
  ])('rejects unsafe media origins %s', (media) => {
    expect(() => securityHeaders({ production: true, media }, nonce)).toThrow();
  });
  it('accepts local development without broadening production and rejects nonce injection', () => {
    expect(
      securityHeaders(
        {
          production: false,
          api: 'http://localhost:8787',
          ws: 'ws://localhost:8787',
        },
        nonce,
      )['Content-Security-Policy'],
    ).toContain("'unsafe-eval'");
    expect(() =>
      securityHeaders(
        { production: true, api: 'http://localhost:8787' },
        nonce,
      ),
    ).toThrow();
    expect(() =>
      securityHeaders({ production: true }, "x';script-src *"),
    ).toThrow();
  });
});
