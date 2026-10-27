/** Disposable synthetic preview only. Importing this module opens no sockets. */
import http from 'node:http';
import { Transform } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve4 } from 'node:dns/promises';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

const id = '[a-zA-Z0-9_-]+';
export function route(raw: string, method = 'GET') {
  // Next encodes dynamic route brackets in public stylesheet/chunk paths.
  // Decode only those two characters, only in the public static namespace.
  // All other escapes and traversal remain rejected before URL normalization.
  const rawPath = raw.split('?')[0] ?? '';
  const path = rawPath.startsWith('/_next/static/')
    ? rawPath.replace(/%5b/gi, '[').replace(/%5d/gi, ']')
    : rawPath;
  if (
    !path.startsWith('/') ||
    /[%\\]/.test(path) ||
    [...path].some((character) => character.charCodeAt(0) <= 32) ||
    path.includes('//') ||
    path.split('/').some((s) => s.startsWith('.'))
  )
    return null;
  const mock = path.startsWith('/mock-api/');
  const target = mock ? path.slice(9) : path;
  const read = method === 'GET' || method === 'HEAD';
  const allowed = mock
    ? (read &&
        new RegExp(
          `^/(health|fixtures/((?:clip-[123]|portrait|square)\\.mp4|frame-(?:landscape|portrait|square)\\.jpg|image\\.png|mask\\.png|identity-lut\\.png|music\\.wav)|v1/(sessions|renders|videos)/${id}|v1/renders/${id}/frame\\.jpg|media/${id})$`,
        ).test(target)) ||
      (method === 'POST' &&
        (['/v1/uploads', '/v1/sessions'].includes(target) ||
          new RegExp(
            `^/v1/(uploads/${id}/complete|sessions/${id}/(ops|messages|approve|reopen)|renders/${id}/cancel)$`,
          ).test(target))) ||
      (method === 'PUT' && new RegExp(`^/mock-r2/${id}(/\\d+)?$`).test(target))
    : read &&
      (target === '/' ||
        new RegExp(`^/(warmup|studio|render|v)/${id}$`).test(target) ||
        /^\/_next\/static\/[a-zA-Z0-9_./[\]@()-]+$/.test(target) ||
        [
          '/grain.png',
          '/luts/warm-film.png',
          '/luts/teal-orange.png',
          '/luts/bleach.png',
          '/luts/mono.png',
          '/icon.svg',
          '/brand/kimo-mark.svg',
          '/fonts/instrument-serif-italic.ttf',
          '/fonts/anton-regular.ttf',
          // Exact Next 15 overlay font, verified by installed upstream middleware test.
          '/__nextjs_font/geist-latin.woff2',
          '/fonts/geist-sans-variable.woff2',
          '/fonts/geist-mono-variable.woff2',
          '/fonts/dm-serif-display-regular.ttf',
        ].includes(target));
  return allowed
    ? {
        mock,
        path: target + raw.slice(rawPath.length),
        port: mock ? 8790 : 3106,
      }
    : null;
}
export function validatePreviewUrl(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/.test(
      value,
    ) ||
    /\s/.test(value)
  ) {
    throw new Error('Invalid temporary preview URL');
  }
  return value;
}
export function rewrite(text: string, publicUrl: string) {
  return text
    .replaceAll('http://localhost:8790', `${publicUrl}/mock-api`)
    .replaceAll(
      'ws://localhost:8790',
      `${publicUrl.replace('https:', 'wss:')}/mock-api`,
    );
}
export function cleanEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    LANG: 'C.UTF-8',
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
  };
}
export const MAX_PREVIEW_BODY_BYTES = 32 * 1024 ** 2;
export function createGateway(publicUrl: string) {
  const server = http.createServer((req, res) => {
    const target = route(req.url ?? '/', req.method);
    if (!target) {
      res.writeHead(404).end();
      return;
    }
    const tooLarge = () => {
      if (!res.headersSent) res.writeHead(413, { Connection: 'close' });
      // Let HTTP flush the 413 before Connection: close tears down the socket.
      res.end('Synthetic preview request exceeds 32 MiB');
      req.resume();
    };
    const declaredLength = req.headers['content-length'];
    if (
      declaredLength !== undefined &&
      (!/^\d+$/.test(declaredLength) ||
        !Number.isSafeInteger(Number(declaredLength)) ||
        Number(declaredLength) > MAX_PREVIEW_BODY_BYTES)
    ) {
      tooLarge();
      return;
    }
    let received = 0;
    let overLimit = false;
    const limited = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > MAX_PREVIEW_BODY_BYTES) {
          overLimit = true;
          callback(new Error('Synthetic preview body limit'));
        } else callback(null, chunk);
      },
    });
    // Do not forward cookies, authorization, proxy headers or hop-by-hop headers.
    const headers: http.OutgoingHttpHeaders = {
      host: `127.0.0.1:${target.port}`,
      'accept-encoding': 'identity',
    };
    for (const key of [
      'content-type',
      'content-length',
      'range',
      'accept',
      'rsc',
      'next-router-state-tree',
      'next-router-prefetch',
    ]) {
      if (req.headers[key]) headers[key] = req.headers[key];
    }
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: target.port,
        path: target.path,
        method: req.method,
        headers,
      },
      (response) => {
        const h = { ...response.headers };
        delete h.connection;
        delete h['set-cookie'];
        delete h['access-control-allow-origin'];
        if (
          target.mock &&
          String(h['content-type']).includes('application/json')
        ) {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            const body = Buffer.from(
              rewrite(Buffer.concat(chunks).toString(), publicUrl),
            );
            delete h['transfer-encoding'];
            delete h['content-encoding'];
            h['content-length'] = String(body.length);
            res.writeHead(response.statusCode ?? 502, h).end(body);
          });
        } else {
          res.writeHead(response.statusCode ?? 502, h);
          response.pipe(res);
        }
        response.on('error', () => res.destroy());
      },
    );
    upstream.setTimeout(60_000, () => upstream.destroy());
    upstream.on('error', () => {
      if (overLimit) return;
      if (!res.headersSent) res.writeHead(502);
      res.end('Synthetic preview unavailable');
    });
    limited.on('error', () => {
      req.unpipe(limited);
      req.pause();
      upstream.destroy();
      tooLarge();
    });
    req.on('error', () => {
      limited.destroy();
      upstream.destroy();
    });
    req.pipe(limited).pipe(upstream);
    res.on('close', () => {
      limited.destroy();
      upstream.destroy();
    });
  });
  server.requestTimeout = 60_000;
  const bridge = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
  });
  const upstreams = new Set<WebSocket>();
  server.on('upgrade', (req, socket, head) => {
    const raw = req.url ?? '';
    const mock = new RegExp(`^/mock-api/v1/sessions/${id}/ws$`).test(raw);
    if (!mock && raw !== '/_next/webpack-hmr') {
      socket.destroy();
      return;
    }
    bridge.handleUpgrade(req, socket, head, (client) => {
      const upstream = new WebSocket(
        `ws://127.0.0.1:${mock ? 8790 : 3106}${mock ? raw.slice(9) : raw}`,
        { maxPayload: 1024 * 1024 },
      );
      upstreams.add(upstream);
      const queued: [RawData, boolean][] = [];
      let bytes = 0;
      client.on('message', (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN)
          upstream.send(data, { binary });
        else {
          bytes += Buffer.byteLength(data.toString());
          if (bytes > 1024 * 1024) {
            client.terminate();
            upstream.terminate();
            return;
          }
          queued.push([data, binary]);
        }
      });
      upstream.on('open', () => {
        for (const [data, binary] of queued) upstream.send(data, { binary });
        queued.length = 0;
      });
      upstream.on('message', (data, binary) => {
        if (client.readyState === WebSocket.OPEN)
          client.send(
            mock && !binary ? rewrite(data.toString(), publicUrl) : data,
            { binary },
          );
      });
      client.on('close', () => upstream.terminate());
      upstream.on('close', () => {
        upstreams.delete(upstream);
        client.terminate();
      });
      client.on('error', () => upstream.terminate());
      upstream.on('error', () => client.terminate());
    });
  });
  return {
    server,
    close() {
      for (const ws of bridge.clients) ws.terminate();
      for (const ws of upstreams) ws.terminate();
      bridge.close();
      server.closeAllConnections();
      server.close();
    },
  };
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function ready(url: string, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      /* bounded retry */
    }
    await delay(1000);
  }
  throw new Error(`HTTP readiness timed out: ${url}`);
}
export async function main() {
  const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  for (const name of [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
  ]) {
    if (existsSync(resolve(root, 'apps/web', name)))
      throw new Error(`Refusing preview with apps/web/${name}`);
  }
  const home = mkdtempSync(resolve(tmpdir(), 'kimo-test-preview-'));
  const env = cleanEnv(home);
  const children: ChildProcess[] = [];
  let gateway: ReturnType<typeof createGateway> | undefined;
  let stopping = false;
  let ttl: ReturnType<typeof setTimeout> | undefined;
  let expiresAt = 0;
  const shutdown = (code = 0) => {
    if (stopping) return;
    stopping = true;
    clearTimeout(startupLimit);
    if (ttl) clearTimeout(ttl);
    gateway?.close();
    for (const child of children)
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          /* already exited */
        }
      }
    setTimeout(() => {
      for (const child of children)
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            /* already exited */
          }
        }
      rmSync(home, { recursive: true, force: true });
      process.exit(code);
    }, 2000);
  };
  const startupLimit = setTimeout(() => shutdown(1), 5 * 60_000);
  process.on('SIGTERM', () => shutdown());
  process.on('SIGINT', () => shutdown());
  const launch = (
    command: string,
    args: string[],
    cwd = root,
    extra: Partial<NodeJS.ProcessEnv> = {},
  ) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...env, ...extra },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    child.on('error', (error) => {
      console.error(error.message);
      shutdown(1);
    });
    child.on('exit', () => {
      if (!stopping) shutdown(1);
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    return child;
  };
  try {
    launch(resolve(root, 'node_modules/.bin/tsx'), [
      '-e',
      `import {createMockServer} from './packages/mock-server/src/index.ts'; const m=createMockServer({port:8790,dataDir:${JSON.stringify(resolve(home, 'mock-data'))}}); m.server.listen(8790,'127.0.0.1');`,
    ]);
    await ready('http://127.0.0.1:8790/health');
    const tunnel = launch(
      resolve(
        process.env.KIMO_CLOUDFLARED ??
          resolve(root, '.preview-tools/cloudflared'),
      ),
      [
        'tunnel',
        '--url',
        'http://127.0.0.1:3105',
        '--protocol',
        'http2',
        '--no-autoupdate',
      ],
    );
    const publicUrl = await new Promise<string>((accept, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Tunnel URL timeout')),
        45_000,
      );
      let text = '';
      const receive = (chunk: Buffer) => {
        text = (text + chunk.toString()).slice(-16_384);
        const found = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (found) {
          clearTimeout(timer);
          accept(validatePreviewUrl(found[0]));
        }
      };
      tunnel.stderr?.on('data', receive);
      tunnel.stdout?.on('data', receive);
    });
    gateway = createGateway(publicUrl);
    await new Promise<void>((accept, reject) => {
      gateway?.server.once('error', reject);
      gateway?.server.listen(3105, '127.0.0.1', accept);
    });
    // Exposure lifetime starts with the gateway, not with readiness or URL publication.
    expiresAt = Date.now() + 15 * 60_000;
    ttl = setTimeout(() => shutdown(0), 15 * 60_000);
    launch(
      resolve(root, 'apps/web/node_modules/.bin/next'),
      ['dev', '-p', '3106', '-H', '127.0.0.1'],
      resolve(root, 'apps/web'),
      {
        NEXT_PUBLIC_KIMO_API: `${publicUrl}/mock-api`,
        KIMO_API_INTERNAL_URL: 'http://127.0.0.1:3105/mock-api',
      },
    );
    const dnsDeadline = Date.now() + 90_000;
    while (true) {
      try {
        await resolve4(new URL(publicUrl).hostname);
        break;
      } catch {
        if (Date.now() >= dnsDeadline)
          throw new Error('Public DNS readiness timed out');
        await delay(1000);
      }
    }
    await ready('http://127.0.0.1:3106/');
    await ready(`${publicUrl}/mock-api/health`);
    await ready(`${publicUrl}/`);
    clearTimeout(startupLimit);
    validatePreviewUrl(publicUrl);
    if (process.env.KIMO_PREVIEW_URL_FILE) {
      const file = process.env.KIMO_PREVIEW_URL_FILE;
      writeFileSync(
        `${file}.tmp`,
        JSON.stringify({
          url: publicUrl,
          expiresAt: new Date(expiresAt).toISOString(),
        }) + '\n',
        { mode: 0o600 },
      );
      renameSync(`${file}.tmp`, file);
    }
    console.log(`KIMO_TEST_PREVIEW_URL=${publicUrl}`);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n### Temporary synthetic frontend preview\n\n${publicUrl}\n\nExpires no later than 15 minutes after gateway start. Synthetic mock only; no engine or provider. Do not upload private media.\n`,
      );
  } catch (error) {
    console.error(error);
    shutdown(1);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main();
