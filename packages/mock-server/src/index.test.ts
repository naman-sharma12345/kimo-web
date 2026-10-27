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
  it('the synthetic agent respects a locked clip and resumes changes only after explicit unlock', async () => {
    const app = await setup();
    try {
      const session = await app.client.createSession({
        prompt: 'edit',
        assetIds: [],
        aspect: 'auto',
      });
      await app.client.ops(
        session.sessionId,
        [
          {
            op: 'track.add',
            track: {
              id: 'v',
              kind: 'video',
              name: 'V1',
              height: 88,
              hidden: false,
              muted: false,
              locked: false,
            },
          },
          {
            op: 'clip.add',
            clip: {
              id: 'locked',
              kind: 'video',
              trackId: 'v',
              assetId: 'synthetic',
              start: 0,
              duration: 4,
              in: 0,
              speed: 1,
              transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
              effects: [],
              keyframes: [],
              locked: true,
            },
          },
        ],
        0,
      );
      await app.client.message(session.sessionId, 'slower');
      await new Promise((resolve) => setTimeout(resolve, 60));
      const locked = await app.client.session(session.sessionId);
      expect(locked.project.version).toBe(1);
      expect(locked.project.clips.locked).toMatchObject({
        duration: 4,
        speed: 1,
        locked: true,
      });
      await app.client.ops(
        session.sessionId,
        [{ op: 'clip.update', id: 'locked', patch: { locked: false } }],
        1,
      );
      await app.client.message(session.sessionId, 'slower');
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(
        (await app.client.session(session.sessionId)).project.clips.locked,
      ).toMatchObject({ duration: 5, speed: 0.8, locked: false });
    } finally {
      await app.close();
    }
  });

  it('attaches only completed upload IDs to the same session, deduplicates them, and never creates a second project', async () => {
    const app = await setup();
    try {
      const session = await app.client.createSession({
        prompt: 'edit',
        assetIds: [],
        aspect: 'auto',
      });
      const { uploads } = await app.client.uploads([
        { name: 'new.mp4', size: 3, mime: 'video/mp4' },
      ]);
      const upload = uploads[0];
      if (!upload) throw new Error('missing upload');
      await expect(
        app.client.message(session.sessionId, '', [upload.assetId]),
      ).rejects.toMatchObject({ status: 400 });
      expect((await app.client.session(session.sessionId)).assets).toHaveLength(
        0,
      );
      expect(
        (await fetch(upload.putUrl, { method: 'PUT', body: 'abc' })).status,
      ).toBe(200);
      await app.client.message(session.sessionId, '', [
        upload.assetId,
        upload.assetId,
      ]);
      await app.client.message(session.sessionId, '', [upload.assetId]);
      const restored = await app.client.session(session.sessionId);
      expect(restored.project.id).toBe(session.sessionId);
      expect(restored.project.version).toBe(0);
      expect(restored.assets.map((asset) => asset.id)).toEqual([
        upload.assetId,
      ]);
      expect(await (await fetch(restored.assets[0]?.url ?? '')).text()).toBe(
        'abc',
      );
    } finally {
      await app.close();
    }
  });

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
      expect(snapshot.actionIds).toEqual([]);
      expect(await (await fetch(snapshot.assets[0]?.url ?? '')).text()).toBe(
        'abc',
      );
      const uploadedUrl = snapshot.assets[0]?.url ?? '';
      const partial = await fetch(uploadedUrl, {
        headers: { Range: 'bytes=1-2' },
      });
      expect(partial.status).toBe(206);
      expect(partial.headers.get('Content-Range')).toBe('bytes 1-2/3');
      expect(await partial.text()).toBe('bc');
      const invalidRange = await fetch(uploadedUrl, {
        headers: { Range: 'bytes=3-' },
      });
      expect(invalidRange.status).toBe(416);
      const mask = await fetch(`${app.base}/fixtures/mask.png`, {
        method: 'HEAD',
      });
      expect(mask.status).toBe(200);
      expect(mask.headers.get('Content-Type')).toBe('image/png');
      expect(Number(mask.headers.get('Content-Length'))).toBeGreaterThan(0);
      expect(await app.client.ops(session.sessionId, [], 0)).toEqual({
        version: 1,
      });
      // A project version bump from client ops is not agent action history.
      expect((await app.client.session(session.sessionId)).actionIds).toEqual(
        [],
      );
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
      const maskEvent = events.find((event) => event.t === 'sam.mask');
      if (!maskEvent || maskEvent.t !== 'sam.mask')
        throw new Error('missing mask event');
      const maskAction = events.find(
        (event) =>
          event.t === 'agent.action.start' && event.id === maskEvent.actionId,
      );
      expect(maskAction).toMatchObject({
        tool: 'sam_mask',
        target: {
          clipId: 'c2',
          coordinateSpace: 'source_uv',
          subjectLabel: 'synthetic ellipse',
        },
      });
      expect(maskEvent.subjectLabel).toBe('synthetic ellipse');
      if (!maskAction) throw new Error('missing correlated mask action');
      expect(events.indexOf(maskAction)).toBeLessThan(
        events.indexOf(maskEvent),
      );
      expect(events.filter((e) => e.t === 'agent.action.start')).toHaveLength(
        45,
      );
      expect(events.filter((e) => e.t === 'warmup.step')).toHaveLength(5);
      expect(events.some((e) => e.t === 'sam.mask')).toBe(true);
      const snapshot = await app.client.session(session.sessionId);
      expect(snapshot.status).toBe('awaiting_review');
      const recordedIds = () => [
        ...new Set(
          events.flatMap((event) =>
            event.t === 'agent.action.start' ? [event.id] : [],
          ),
        ),
      ];
      expect(snapshot.actionIds).toEqual(recordedIds());
      expect(snapshot.actionIds).toHaveLength(45);
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
      // Restore through actual REST after disconnect, including actions emitted
      // with no subscriber. Do not reconstruct IDs from project versions.
      await new Promise<void>((resolve) => {
        ws.once('close', resolve);
        ws.close();
      });
      const restored = await app.client.session(session.sessionId);
      expect(restored.actionIds).toEqual(recordedIds());
      expect(restored.actionIds).toHaveLength(48);
      const latest = await app.client.ops(
        session.sessionId,
        [],
        restored.project.version,
      );
      expect(latest.version).toBe(restored.project.version + 1);
      expect((await app.client.session(session.sessionId)).actionIds).toEqual(
        restored.actionIds,
      );
      await app.client.message(session.sessionId, 'slower again');
      await new Promise((resolve) => setTimeout(resolve, 40));
      const offline = await app.client.session(session.sessionId);
      expect(offline.actionIds?.slice(0, 48)).toEqual(restored.actionIds);
      expect(offline.actionIds).toHaveLength(51);
      expect(new Set(offline.actionIds).size).toBe(51);
      expect(
        offline.actionIds
          ?.slice(48)
          .every((id) => !restored.actionIds?.includes(id)),
      ).toBe(true);
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
