// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { KimoClient, serverEventSchema } from '@kimo/client';
import { WebSocket } from 'ws';
import { createMockServer } from './index';

it('presigns default 16 MiB parts only above 100 MiB without allocating file bytes', async () => {
  const dataDir = await mkdtemp(resolve(process.cwd(), '.mock-test-'));
  const mock = createMockServer({ port: 0, dataDir });
  try {
    const client = new KimoClient(await mock.start());
    const { uploads } = await client.uploads([
      { name: 'boundary', size: 100 * 1024 ** 2, mime: 'video/mp4' },
      { name: 'large', size: 150 * 1024 ** 2, mime: 'video/mp4' },
    ]);
    expect(uploads[0]?.parts).toBeUndefined();
    expect(uploads[1]?.parts?.map((p) => p.partNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  } finally {
    await mock.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

it('validates multipart sizes, rejects invalid manifests, finalizes atomically and idempotently', async () => {
  const dataDir = await mkdtemp(resolve(process.cwd(), '.mock-test-'));
  const mock = createMockServer({
    port: 0,
    speed: 1000,
    dataDir,
    multipartThreshold: 5,
    partSize: 4,
  });
  try {
    const client = new KimoClient(await mock.start());
    const upload = (
      await client.uploads([{ name: 'tiny.mp4', size: 10, mime: 'video/mp4' }])
    ).uploads[0];
    if (!upload?.parts) throw new Error('missing parts');
    const session = await client.createSession({
      prompt: 'edit',
      assetIds: [upload.assetId],
      aspect: 'auto',
    });
    const assetUrl = (await client.session(session.sessionId)).assets[0]?.url;
    if (!assetUrl) throw new Error('missing asset');
    expect((await fetch(assetUrl)).status).toBe(404);
    expect(
      (await fetch(upload.putUrl, { method: 'PUT', body: '0123456789' }))
        .status,
    ).toBe(400);
    expect(
      (
        await fetch(upload.parts[0]?.putUrl ?? '', {
          method: 'PUT',
          body: 'bad',
        })
      ).status,
    ).toBe(400);
    const parts = await Promise.all(
      upload.parts.map(async (part, i) => {
        const response = await fetch(part.putUrl, {
          method: 'PUT',
          body: ['abcd', 'efgh', 'ij'][i],
        });
        expect(response.status).toBe(200);
        return {
          partNumber: part.partNumber,
          etag: response.headers.get('etag') ?? '',
        };
      }),
    );
    await expect(
      client.completeUpload(upload.assetId, parts.slice(0, 2)),
    ).rejects.toMatchObject({ status: 400 });
    const first = parts[0];
    const last = parts[2];
    if (!first || !last) throw new Error('missing completion parts');
    await expect(
      client.completeUpload(upload.assetId, [first, first, last]),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      client.completeUpload(
        upload.assetId,
        parts.map((p) => ({ ...p, etag: 'bad' })),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect((await fetch(assetUrl)).status).toBe(404);
    await Promise.all([
      client.completeUpload(upload.assetId, [...parts].reverse()),
      client.completeUpload(upload.assetId, parts),
    ]);
    expect(await (await fetch(assetUrl)).text()).toBe('abcdefghij');
    expect(await client.completeUpload(upload.assetId, parts)).toEqual({
      ok: true,
    });
    expect(
      (
        await fetch(upload.parts[0]?.putUrl ?? '', {
          method: 'PUT',
          body: 'zzzz',
        })
      ).status,
    ).toBe(409);
    expect(await (await fetch(assetUrl)).text()).toBe('abcdefghij');
  } finally {
    await mock.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

it('checks single PUT size and disallows completing a non-multipart upload', async () => {
  const dataDir = await mkdtemp(resolve(process.cwd(), '.mock-test-'));
  const mock = createMockServer({ port: 0, dataDir });
  try {
    const client = new KimoClient(await mock.start());
    const upload = (
      await client.uploads([{ name: 'a', size: 3, mime: 'image/png' }])
    ).uploads[0];
    if (!upload) throw new Error('missing upload');
    expect(
      (await fetch(upload.putUrl, { method: 'PUT', body: 'ab' })).status,
    ).toBe(400);
    await expect(
      client.completeUpload(upload.assetId, []),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (await fetch(upload.putUrl, { method: 'PUT', body: 'abc' })).status,
    ).toBe(200);
  } finally {
    await mock.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

it('creates sessions before upload finishes and holds websocket editing until bytes arrive', async () => {
  const dataDir = await mkdtemp(resolve(process.cwd(), '.mock-test-'));
  const mock = createMockServer({ port: 0, speed: 1000, dataDir });
  try {
    const client = new KimoClient(await mock.start());
    const upload = (
      await client.uploads([{ name: 'clip', size: 3, mime: 'video/mp4' }])
    ).uploads[0];
    if (!upload) throw new Error('missing upload');
    const session = await client.createSession({
      prompt: 'edit',
      assetIds: [upload.assetId],
      aspect: 'auto',
    });
    const ws = new WebSocket(session.wsUrl);
    let editing = false;
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('warmup timeout')),
        2000,
      );
      ws.on('message', (raw) => {
        const event = serverEventSchema.parse(JSON.parse(raw.toString()));
        if (event.t === 'project.ops') editing = true;
        if (event.t === 'warmup.step' && event.step === 'ready') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(editing).toBe(false);
    expect((await client.session(session.sessionId)).status).toBe('warming');
    expect(
      (await fetch(upload.putUrl, { method: 'PUT', body: 'abc' })).ok,
    ).toBe(true);
    await ready;
    expect((await client.session(session.sessionId)).status).not.toBe(
      'warming',
    );
    ws.close();
  } finally {
    await mock.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
