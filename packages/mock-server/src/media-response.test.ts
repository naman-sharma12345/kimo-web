// @vitest-environment node
import { expect, it } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mediaResponse } from './media-response';

it('serves exact and suffix byte ranges for synthetic seek requests', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.mock-test-'));
  const file = resolve(directory, 'bytes.bin');
  await writeFile(file, '0123456789');
  const server = http.createServer(
    (req, res) => void mediaResponse(req, res, file),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('missing address');
  const url = `http://127.0.0.1:${address.port}/fixture`;
  try {
    for (const [range, expected, contentRange] of [
      ['bytes=2-5', '2345', 'bytes 2-5/10'],
      ['bytes=7-', '789', 'bytes 7-9/10'],
      ['bytes=-3', '789', 'bytes 7-9/10'],
      ['bytes=8-999', '89', 'bytes 8-9/10'],
    ]) {
      const response = await fetch(url, { headers: { Range: range ?? '' } });
      expect(response.status).toBe(206);
      expect(response.headers.get('Content-Range')).toBe(contentRange);
      expect(await response.text()).toBe(expected);
    }
    for (const range of [
      'bytes=10-',
      'bytes=5-2',
      'bytes=-0',
      'bytes=-',
      'bytes=0-1,3-4',
      'bytes=999999999999999999999-',
    ]) {
      const response = await fetch(url, { headers: { Range: range } });
      expect(response.status).toBe(416);
      expect(response.headers.get('Content-Range')).toBe('bytes */10');
      expect(await response.text()).toBe('');
    }
    const head = await fetch(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe('10');
    expect(await head.text()).toBe('');
    expect(await (await fetch(url)).text()).toBe('0123456789');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
