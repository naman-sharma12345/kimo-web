/** AUTHORED NOT RUN. Start only on a separately authorized disposable runner.
 * Read-only synthetic fixture service for Next SSR: page.route cannot intercept SSR.
 * No session creation, approval, auth, quota enforcement or engine integration.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { events, render, snapshot, video } from './phase10-fixtures';

const media = new Map([
  ['clip-1.mp4', 'video/mp4'],
  ['frame-landscape.jpg', 'image/jpeg'],
]);
const server = createServer((request, response) => {
  const allowedOrigins = new Set([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:8791');
  if (url.pathname === '/health') {
    response.end('phase10 synthetic fixture');
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.writeHead(503).end('fixture intentionally refuses mutations');
    return;
  }
  const match = /^\/v1\/(sessions|renders|videos)\/([a-z0-9-]+)$/.exec(
    url.pathname,
  );
  if (match) {
    const [, kind, id = ''] = match;
    if (id.endsWith('missing')) {
      response.writeHead(404).end();
      return;
    }
    if (id.endsWith('expired')) {
      response.writeHead(410).end();
      return;
    }
    if (id.endsWith('unavailable')) {
      response.writeHead(503).end();
      return;
    }
    const data =
      kind === 'sessions'
        ? snapshot(id)
        : kind === 'renders'
          ? render(id)
          : video(id);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(data));
    return;
  }
  const frame = /^\/v1\/renders\/[a-z0-9-]+\/frame\.jpg$/.test(url.pathname);
  const name = frame
    ? 'frame-landscape.jpg'
    : url.pathname.slice('/fixtures/'.length);
  if ((frame || url.pathname.startsWith('/fixtures/')) && media.has(name)) {
    void readFile(
      fileURLToPath(
        new URL(`../packages/mock-server/fixtures/${name}`, import.meta.url),
      ),
    )
      .then((bytes) => {
        const range = request.headers.range;
        const parsed = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
        const start = parsed ? Number(parsed[1]) : 0;
        const end = parsed?.[2]
          ? Math.min(Number(parsed[2]), bytes.length - 1)
          : bytes.length - 1;
        if ((range && !parsed) || start > end || start >= bytes.length) {
          response
            .writeHead(416, { 'Content-Range': `bytes */${bytes.length}` })
            .end();
          return;
        }
        response.setHeader(
          'Content-Type',
          media.get(name) ?? 'application/octet-stream',
        );
        response.setHeader('Accept-Ranges', 'bytes');
        response.setHeader('Content-Length', end - start + 1);
        if (parsed)
          response.setHeader(
            'Content-Range',
            `bytes ${start}-${end}/${bytes.length}`,
          );
        response.writeHead(parsed ? 206 : 200);
        response.end(
          request.method === 'HEAD'
            ? undefined
            : bytes.subarray(start, end + 1),
        );
      })
      .catch(() => response.writeHead(404).end('fixture bytes unavailable'));
    return;
  }
  response.writeHead(404).end();
});
const sockets = new WebSocketServer({ server, maxPayload: 65536 });
sockets.on('connection', (socket, request) => {
  const id = /^\/live\/([a-z0-9-]+)$/.exec(request.url ?? '')?.[1];
  if (!id) {
    socket.close(1008);
    return;
  }
  for (const event of events(id)) socket.send(JSON.stringify(event));
  if (id.endsWith('offline')) socket.close(1012, 'synthetic disconnect');
});
server.listen(8791, '127.0.0.1');
function stop() {
  for (const socket of sockets.clients) socket.terminate();
  sockets.close();
  server.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
