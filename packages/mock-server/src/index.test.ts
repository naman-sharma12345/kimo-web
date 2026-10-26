// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { KimoClient, serverEventSchema, type ServerEvent } from '@kimo/client';
import { createMockServer } from './index';
async function setup(
  fail?: string,
  multipartThreshold?: number,
  partSize?: number,
) {
  const dataDir = await mkdtemp(resolve(process.cwd(), '.mock-test-'));
  const mock = createMockServer({
    port: 0,
    speed: 1000,
    fail,
    dataDir,
    multipartThreshold,
    partSize,
  });
  const base = await mock.start();
  return {
    mock,
    base,
    client: new KimoClient(base),
    async close() {
      await mock.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
describe('mock HTTP and websocket integration', () => {
  it('persists uploaded bytes, rejects incomplete assets, enforces versions and completes render', async () => {
    const app = await setup();
    try {
      const { uploads } = await app.client.uploads([
        { name: 'clip.mp4', size: 3, mime: 'video/mp4' },
      ]);
      const upload = uploads[0];
      if (!upload) throw new Error('missing upload');
      const early = await app.client.createSession({
        prompt: 'edit',
        assetIds: [upload.assetId],
        aspect: 'auto',
      });
      expect((await app.client.session(early.sessionId)).status).toBe(
        'warming',
      );
      expect(
        (await fetch(upload.putUrl, { method: 'PUT', body: 'abc' })).ok,
      ).toBe(true);
      const session = await app.client.createSession({
        prompt: 'edit',
        assetIds: [upload.assetId],
        aspect: '9:16',
      });
      const snapshot = await app.client.session(session.sessionId);
      expect(snapshot.project.width).toBe(1080);
      expect(snapshot.wsUrl).toBe(session.wsUrl);
      expect(await (await fetch(snapshot.assets[0]?.url ?? '')).text()).toBe(
        'abc',
      );
      expect(await app.client.ops(session.sessionId, [], 0)).toEqual({
        version: 1,
      });
      await expect(
        app.client.ops(session.sessionId, [], 0),
      ).rejects.toMatchObject({ status: 409 });
      await app.client.message(session.sessionId, 'slower');
      const { renderId } = await app.client.approve(session.sessionId);
      expect((await app.client.session(session.sessionId)).renderId).toBe(
        renderId,
      );
      await new Promise((r) => setTimeout(r, 40));
      expect((await app.client.session(session.sessionId)).videoId).toBe(
        session.sessionId,
      );
      const render = await app.client.render(renderId);
      expect(render).toMatchObject({ status: 'done', progress: 1 });
      expect((await app.client.video(render.videoId ?? '')).url).toContain(
        '/fixtures/',
      );
    } finally {
      await app.close();
    }
  });
  it('streams 45 semantic actions with valid contracts, captions, mask, attribution and responsive interruption', async () => {
    const app = await setup();
    try {
      const session = await app.client.createSession({
        prompt: 'edit',
        assetIds: [],
        aspect: 'auto',
      });
      const events: ServerEvent[] = [];
      const ws = new WebSocket(session.wsUrl);
      const waitFor = (predicate: (e: ServerEvent) => boolean) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('stream timeout')),
            3000,
          );
          const listener = (raw: Buffer) => {
            try {
              const e = serverEventSchema.parse(JSON.parse(raw.toString()));
              if (predicate(e)) {
                clearTimeout(timer);
                ws.off('message', listener);
                resolve();
              }
            } catch (error) {
              clearTimeout(timer);
              reject(error);
            }
          };
          ws.on('message', listener);
        });
      ws.on('message', (raw) =>
        events.push(serverEventSchema.parse(JSON.parse(raw.toString()))),
      );
      await waitFor((e) => e.t === 'agent.message' && e.kind === 'ask_review');
      expect(events.filter((e) => e.t === 'agent.action.start')).toHaveLength(
        45,
      );
      expect(events.filter((e) => e.t === 'warmup.step')).toHaveLength(5);
      expect(events.some((e) => e.t === 'sam.mask')).toBe(true);
      const snapshot = await app.client.session(session.sessionId);
      expect(snapshot.status).toBe('awaiting_review');
      expect(snapshot.project.clips.captions?.text?.words).toHaveLength(5);
      expect(
        snapshot.assets.find((a) => a.id === 'web-original')?.attribution,
      ).toBeDefined();
      expect(snapshot.project.clips['web-image']).toBeDefined();
      const response = waitFor(
        (e) => e.t === 'agent.message' && e.kind === 'say',
      );
      ws.send(JSON.stringify({ t: 'interrupt', text: 'slower please' }));
      await response;
      expect(
        (await app.client.session(session.sessionId)).project.clips.c1?.speed,
      ).toBe(0.8);
      expect(events.filter((e) => e.t === 'agent.action.start')).toHaveLength(
        48,
      );
      ws.close();
    } finally {
      await app.close();
    }
  });
  it('supports upload and render failure flags without returning successful video IDs', async () => {
    for (const fail of ['upload', 'render']) {
      const app = await setup(fail);
      try {
        if (fail === 'upload') {
          const { uploads } = await app.client.uploads([
            { name: 'a', size: 1, mime: 'image/png' },
          ]);
          expect(
            (
              await fetch(uploads[0]?.putUrl ?? '', {
                method: 'PUT',
                body: 'a',
              })
            ).status,
          ).toBe(503);
        } else {
          const session = await app.client.createSession({
            prompt: 'edit',
            assetIds: [],
            aspect: 'auto',
          });
          const { renderId } = await app.client.approve(session.sessionId);
          await new Promise((r) => setTimeout(r, 40));
          const render = await app.client.render(renderId);
          expect(render.status).toBe('failed');
          expect(render.videoId).toBeUndefined();
        }
      } finally {
        await app.close();
      }
    }
  });
});
