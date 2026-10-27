// @vitest-environment node
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';
import {
  MAX_PREVIEW_BODY_BYTES,
  cleanEnv,
  createGateway,
  rewrite,
  route,
  validatePreviewUrl,
} from './preview';

describe('disposable preview boundary', () => {
  it('serves encoded Next route assets without permitting other escapes or traversal', () => {
    expect(
      route('/_next/static/css/app/studio/%5BsessionId%5D/page.css?v=42'),
    ).toEqual({
      mock: false,
      path: '/_next/static/css/app/studio/[sessionId]/page.css?v=42',
      port: 3106,
    });
    expect(
      route('/_next/static/chunks/app/warmup/%5bsessionId%5d/page.js')?.path,
    ).toBe('/_next/static/chunks/app/warmup/[sessionId]/page.js');
    expect(route('/icon.svg?version=1')?.path).toBe('/icon.svg?version=1');
    for (const path of [
      '/_next/static/%2e%2e/.env',
      '/_next/static/css/%2fetc/passwd',
      '/_next/static/css/%255BsessionId%255D/page.css',
      '/_next/static/css/[id]/../.env',
      '/studio/%5BsessionId%5D',
    ])
      expect(route(path)).toBeNull();
  });
  it('allows only frontend pages and required public assets', () => {
    for (const path of [
      '/',
      '/warmup/test-123',
      '/studio/test-123',
      '/grain.png',
      '/luts/warm-film.png',
      '/luts/teal-orange.png',
      '/luts/bleach.png',
      '/luts/mono.png',
      '/brand/kimo-mark.svg',
      '/fonts/instrument-serif-italic.ttf',
      '/fonts/geist-sans-variable.woff2',
      '/fonts/geist-mono-variable.woff2',
      '/__nextjs_font/geist-latin.woff2',
      '/_next/static/chunks/app/studio/[sessionId]/page.js?x=1',
    ])
      expect(route(path)).not.toBeNull();
    for (const path of [
      '/api',
      '/api/private',
      '/.env',
      '/.git/config',
      '/.openclaw/state',
      '/node_modules/ws/index.js',
      '/workspace/a',
      '/dev/ui',
      '/_next/server/app.js',
      '/_next/image?url=http://example.com',
      '/%2e%2e/.env',
      '/studio/../api',
      '/studio/a%2fb',
      '//example.com',
      '/fonts/../../.env',
      '/fonts/%2e%2e/.env',
      '/fonts/unknown.woff2',
      '/luts/unknown.png',
      '/luts/../../.env',
      '/luts/%2e%2e/.env',
      '/__nextjs_font/anything',
      '/__nextjs_font/geist-latin.woff2/extra',
      '/__nextjs_font/../.env',
      '/__nextjs_font/%2e%2e/.env',
      '/__nextjs_launch-editor',
      '/_next/static/.secret',
      '/mock-api/health/../admin',
    ])
      expect(route(path)).toBeNull();
    expect(route('/', 'POST')).toBeNull();
  });
  it('uses exact synthetic REST methods and rejects nonallowlisted API routes', () => {
    for (const [path, method] of [
      ['/health', 'GET'],
      ['/fixtures/clip-1.mp4', 'GET'],
      ['/v1/sessions/abc', 'GET'],
      ['/v1/renders/abc', 'GET'],
      ['/v1/videos/abc', 'GET'],
      ['/v1/uploads', 'POST'],
      ['/v1/uploads/abc/complete', 'POST'],
      ['/v1/sessions', 'POST'],
      ['/v1/sessions/abc/approve', 'POST'],
      ['/v1/sessions/abc/messages', 'POST'],
      ['/v1/sessions/abc/ops', 'POST'],
      ['/mock-r2/abc/1', 'PUT'],
      ['/media/abc', 'GET'],
    ])
      expect(route(`/mock-api${path}`, method)?.port).toBe(8790);
    for (const path of [
      '/mock-api/admin',
      '/mock-api/v1/secrets',
      '/mock-api/fixtures/secrets.txt',
      '/mock-api/v1/sessions/a/anything',
      '/mock-api/mock-r2/a/1/extra',
    ])
      expect(route(path)).toBeNull();
    expect(route('/mock-api/v1/sessions', 'DELETE')).toBeNull();
    expect(route('/mock-api/v1/sessions/a/messages')).toBeNull();
  });
  it('rewrites mock HTTP and websocket URLs in nested JSON and events', () => {
    expect(
      rewrite(
        '{"url":"http://localhost:8790/media/a","ws":"ws://localhost:8790/v1/sessions/a/ws"}',
        'https://example.trycloudflare.com',
      ),
    ).toBe(
      '{"url":"https://example.trycloudflare.com/mock-api/media/a","ws":"wss://example.trycloudflare.com/mock-api/v1/sessions/a/ws"}',
    );
  });
  it('does not inherit credentials or provider configuration', () => {
    const env = cleanEnv('/disposable');
    expect(Object.keys(env).sort()).toEqual([
      'HOME',
      'LANG',
      'NEXT_TELEMETRY_DISABLED',
      'NODE_ENV',
      'PATH',
    ]);
    expect(env.HOME).toBe('/disposable');
  });
  it('serves a local HTTP deny response without starting any child or tunnel', async () => {
    const gateway = createGateway('https://example.trycloudflare.com');
    gateway.server.listen(0, '127.0.0.1');
    await once(gateway.server, 'listening');
    try {
      const address = gateway.server.address();
      if (!address || typeof address === 'string')
        throw new Error('missing address');
      const status = await new Promise<number | undefined>((accept, reject) => {
        http
          .get(`http://127.0.0.1:${address.port}/.env`, (response) => {
            response.resume();
            accept(response.statusCode);
          })
          .on('error', reject);
      });
      expect(status).toBe(404);
    } finally {
      gateway.close();
    }
  });
});

describe('local synthetic HTTP and websocket smoke', () => {
  it('creates a mock session, rewrites its URLs and bridges websocket events', async () => {
    const { createMockServer } = await import('./index');
    const { WebSocket } = await import('ws');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dataDir = mkdtempSync(join(tmpdir(), 'kimo-preview-test-'));
    const mock = createMockServer({ port: 8790, dataDir });
    const gateway = createGateway('https://synthetic.trycloudflare.com');
    let ws: InstanceType<typeof WebSocket> | undefined;
    try {
      mock.server.listen(8790, '127.0.0.1');
      await once(mock.server, 'listening');
      gateway.server.listen(0, '127.0.0.1');
      await once(gateway.server, 'listening');
      const address = gateway.server.address();
      if (!address || typeof address === 'string')
        throw new Error('missing address');
      const base = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${base}/mock-api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'synthetic smoke',
          assetIds: [],
          aspect: 'auto',
        }),
      });
      expect(response.status).toBe(200);
      const session = (await response.json()) as {
        sessionId: string;
        wsUrl: string;
      };
      expect(session.wsUrl).toBe(
        `wss://synthetic.trycloudflare.com/mock-api/v1/sessions/${session.sessionId}/ws`,
      );
      ws = new WebSocket(
        `${base.replace('http:', 'ws:')}/mock-api/v1/sessions/${session.sessionId}/ws`,
      );
      const [message] = await once(ws, 'message');
      expect(String(message)).toContain('hello');
      const snapshot = await fetch(
        `${base}/mock-api/v1/sessions/${session.sessionId}`,
      );
      const text = await snapshot.text();
      expect(text).toContain(
        'https://synthetic.trycloudflare.com/mock-api/fixtures/clip-1.mp4',
      );
      expect(text).not.toContain('localhost:8790');
      expect((await fetch(`${base}/mock-api/admin`)).status).toBe(404);
    } finally {
      ws?.terminate();
      gateway.close();
      await mock.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('artifact URL validation', () => {
  it('accepts only a bare HTTPS nonce on the exact trycloudflare domain', () => {
    expect(
      validatePreviewUrl('https://fresh-synthetic-nonce.trycloudflare.com'),
    ).toBe('https://fresh-synthetic-nonce.trycloudflare.com');
    for (const value of [
      null,
      123,
      ['https://fresh.trycloudflare.com'],
      { url: 'https://fresh.trycloudflare.com' },
      'http://fresh.trycloudflare.com',
      'https://trycloudflare.com',
      'https://fresh.trycloudflare.com.evil.test',
      'https://evil.test/fresh.trycloudflare.com',
      'https://user:pass@fresh.trycloudflare.com',
      'https://fresh.trycloudflare.com:443',
      'https://fresh.trycloudflare.com/',
      'https://fresh.trycloudflare.com?token=abc',
      'https://fresh.trycloudflare.com#fragment',
      'https://fresh.trycloudflare.com\nINJECTED=value',
      'https://fresh.trycloudflare.com\n',
      'https://-fresh.trycloudflare.com',
      'https://fresh-.trycloudflare.com',
      'https://a.b.trycloudflare.com',
      `https://${'a'.repeat(64)}.trycloudflare.com`,
    ])
      expect(() => validatePreviewUrl(value)).toThrow();
  });
});

describe('HTTP body ceiling', () => {
  it('rejects oversized declared and chunked bodies with 413 before unbounded upstream writes', async () => {
    let requests = 0;
    let forwarded = 0;
    const sink = http.createServer((req, res) => {
      requests++;
      req.on('data', (chunk: Buffer) => {
        forwarded += chunk.length;
      });
      req.on('error', () => {});
      req.on('end', () => res.end('ok'));
    });
    const gateway = createGateway('https://synthetic.trycloudflare.com');
    sink.listen(8790, '127.0.0.1');
    await once(sink, 'listening');
    gateway.server.listen(0, '127.0.0.1');
    await once(gateway.server, 'listening');
    const address = gateway.server.address();
    if (!address || typeof address === 'string')
      throw new Error('missing address');
    const send = (declared: boolean, megabytes = 33) =>
      new Promise<number | undefined>((accept, reject) => {
        const request = http.request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: '/mock-api/mock-r2/synthetic',
            method: 'PUT',
            headers: declared
              ? { 'Content-Length': String(MAX_PREVIEW_BODY_BYTES + 1) }
              : { 'Transfer-Encoding': 'chunked' },
          },
          (response) => {
            response.resume();
            accept(response.statusCode);
          },
        );
        // ECONNRESET/EPIPE after receiving 413 is expected when the server closes.
        request.on('error', reject);
        if (!declared) {
          const chunk = Buffer.alloc(1024 * 1024);
          for (let i = 0; i < megabytes; i++) request.write(chunk);
        }
        request.end();
      });
    try {
      expect(await send(false, 32)).toBe(200);
      expect(forwarded).toBe(MAX_PREVIEW_BODY_BYTES);
      requests = 0;
      forwarded = 0;
      expect(await send(true)).toBe(413);
      expect(requests).toBe(0);
      expect(await send(false)).toBe(413);
      expect(requests).toBe(1);
      expect(forwarded).toBeLessThanOrEqual(MAX_PREVIEW_BODY_BYTES);
    } finally {
      gateway.close();
      sink.closeAllConnections();
      await new Promise<void>((accept) => sink.close(() => accept()));
    }
  });
});

describe('exact public and installed Next overlay font routes', () => {
  it('forwards only legitimate font paths and verifies real upstream overlay WOFF2 bytes', async () => {
    const { createRequire } = await import('node:module');
    const { readFileSync } = await import('node:fs');
    const webRequire = createRequire(
      new URL('../../../apps/web/package.json', import.meta.url),
    );
    const { getDevOverlayFontMiddleware } = webRequire(
      'next/dist/next-devtools/server/font/get-dev-overlay-font-middleware.js',
    ) as {
      getDevOverlayFontMiddleware: () => (
        req: http.IncomingMessage,
        res: http.ServerResponse,
        next: () => void,
      ) => Promise<void>;
    };
    const middleware = getDevOverlayFontMiddleware();
    const fonts = new Map(
      [
        '/fonts/geist-sans-variable.woff2',
        '/fonts/geist-mono-variable.woff2',
      ].map((path) => [
        path,
        readFileSync(
          new URL(`../../../apps/web/public${path}`, import.meta.url),
        ),
      ]),
    );
    const seen: string[] = [];
    const frontend = http.createServer((req, res) => {
      seen.push(req.url ?? '');
      void middleware(req, res, () => {
        const bytes = fonts.get(req.url ?? '');
        if (bytes)
          res.writeHead(200, { 'content-type': 'font/woff2' }).end(bytes);
        else res.writeHead(404).end();
      });
    });
    const gateway = createGateway('https://synthetic.trycloudflare.com');
    frontend.listen(3106, '127.0.0.1');
    await once(frontend, 'listening');
    gateway.server.listen(0, '127.0.0.1');
    await once(gateway.server, 'listening');
    try {
      const address = gateway.server.address();
      if (!address || typeof address === 'string')
        throw new Error('missing address');
      for (const path of [
        ...fonts.keys(),
        '/__nextjs_font/geist-latin.woff2',
      ]) {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('font/woff2');
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(bytes.subarray(0, 4).toString()).toBe('wOF2');
        if (fonts.has(path)) expect(bytes).toEqual(fonts.get(path));
      }
      const forwarded = seen.length;
      const denied = await fetch(
        `http://127.0.0.1:${address.port}/__nextjs_font/private.woff2`,
      );
      expect(denied.status).toBe(404);
      expect(seen).toHaveLength(forwarded);
      expect(
        readFileSync(
          new URL(
            '../../../apps/web/public/fonts/geist-OFL.txt',
            import.meta.url,
          ),
          'utf8',
        ),
      ).toContain('SIL OPEN FONT LICENSE Version 1.1');
    } finally {
      gateway.close();
      await new Promise<void>((done, reject) =>
        frontend.close((error) => (error ? reject(error) : done())),
      );
    }
  });
});
