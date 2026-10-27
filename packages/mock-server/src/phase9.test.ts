// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { KimoClient } from '@kimo/client';
import { createMockServer } from './index';
import { route } from './preview';
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function setup(options: Parameters<typeof createMockServer>[0] = {}) {
  const dataDir = await mkdtemp(resolve(process.cwd(), '.mock-test-'));
  const mock = createMockServer({ port: 0, speed: 100, dataDir, ...options });
  const base = await mock.start();
  return {
    base,
    client: new KimoClient(base),
    async close() {
      await mock.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
const create = (client: KimoClient) =>
  client.createSession({ prompt: 'synthetic', assetIds: [], aspect: '9:16' });
describe('Phase 9 synthetic render lifecycle', () => {
  it('validates before mutation, deduplicates, fences edits, cancels permanently and guards old jobs', async () => {
    const app = await setup();
    try {
      const { sessionId } = await create(app.client);
      await expect(
        app.client.approve(sessionId, { expectedProjectVersion: 1 }),
      ).rejects.toMatchObject({ status: 409 });
      expect((await app.client.session(sessionId)).renderId).toBeUndefined();
      const invalid = await fetch(
        `${app.base}/v1/sessions/${sessionId}/approve`,
        { method: 'POST', body: '{"unexpected":true}' },
      );
      expect(invalid.status).toBe(400);
      const input = {
        title: 'portrait cut',
        preset: '1080p' as const,
        burnInCaptions: false,
        expectedProjectVersion: 0,
      };
      const { renderId } = await app.client.approve(sessionId, input);
      expect(await app.client.approve(sessionId, input)).toEqual({ renderId });
      await expect(
        app.client.approve(sessionId, { ...input, title: 'different' }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(app.client.ops(sessionId, [], 0)).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        app.client.message(sessionId, 'change'),
      ).rejects.toMatchObject({ status: 409 });
      const cancelled = await app.client.cancelRender(renderId);
      expect(cancelled).toEqual({ status: 'cancelled', sessionId });
      expect(await app.client.cancelRender(renderId)).toEqual(cancelled);
      expect((await app.client.session(sessionId)).status).toBe('editing');
      const second = await app.client.approve(sessionId, input);
      expect(second.renderId).not.toBe(renderId);
      await wait(290);
      expect((await app.client.render(renderId)).status).toBe('cancelled');
      const done = await app.client.render(second.renderId);
      expect(done.status).toBe('done');
      expect(done.videoId).not.toBe(sessionId);
      expect(
        (await fetch(app.client.renderFrameUrl(second.renderId, done.frame)))
          .status,
      ).toBe(200);
      expect(
        (
          await fetch(
            app.client.renderFrameUrl(second.renderId, done.totalFrames + 1),
          )
        ).status,
      ).toBe(404);
      expect(done).toMatchObject({
        fps: 30,
        frame: 240,
        totalFrames: 240,
        chunkIndex: 8,
      });
      const video = await app.client.video(done.videoId ?? '');
      expect(video).toMatchObject({
        title: 'portrait cut',
        width: 1080,
        height: 1920,
        durationSec: 8,
        sessionId,
      });
      expect(video.audio).toBeUndefined();
      expect(video.models).toBeUndefined();
      expect(video.history).toBeUndefined();
      await expect(
        app.client.cancelRender(second.renderId),
      ).rejects.toMatchObject({ status: 409 });
      expect(await app.client.reopenSession(sessionId)).toEqual({
        status: 'editing',
      });
      await app.client.ops(sessionId, [], 0);
      expect(await app.client.video(done.videoId ?? '')).toEqual(video);
      const third = await app.client.approve(sessionId, {
        expectedProjectVersion: 1,
      });
      expect((await app.client.session(sessionId)).renderId).toBe(
        third.renderId,
      );
      expect((await app.client.render(second.renderId)).status).toBe('done');
      expect((await app.client.session(sessionId)).status).toBe('rendering');
      expect(await app.client.video(done.videoId ?? '')).toEqual(video);
    } finally {
      await app.close();
    }
  });
  it('serves actual JPEG only for available discrete frames and exact methods/paths', async () => {
    const app = await setup();
    try {
      const { sessionId } = await create(app.client);
      const { renderId } = await app.client.approve(sessionId);
      await wait(30);
      const url = app.client.renderFrameUrl(renderId, 0);
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      expect([
        ...new Uint8Array(await response.arrayBuffer()).slice(0, 3),
      ]).toEqual([255, 216, 255]);
      expect(response.headers.get('cache-control')).toContain('immutable');
      const head = await fetch(url, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect((await head.arrayBuffer()).byteLength).toBe(0);
      for (const n of ['', '-1', '1.5', 'NaN', '9007199254740992', '1&n=2'])
        expect(
          (await fetch(`${app.base}/v1/renders/${renderId}/frame.jpg?n=${n}`))
            .status,
        ).toBe(400);
      expect(
        (await fetch(app.client.renderFrameUrl(renderId, 239))).status,
      ).toBe(404);
      for (const suffix of ['/frame.jpg/extra?n=0', '/other', '/cancel/extra'])
        expect(
          (await fetch(`${app.base}/v1/renders/${renderId}${suffix}`)).status,
        ).toBe(404);
      expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(
        404,
      );
      await expect(app.client.render('unknown')).rejects.toMatchObject({
        status: 404,
      });
      await expect(app.client.cancelRender('unknown')).rejects.toMatchObject({
        status: 404,
      });
      await expect(app.client.reopenSession('unknown')).rejects.toMatchObject({
        status: 404,
      });
      await expect(app.client.video('unknown')).rejects.toMatchObject({
        status: 404,
      });
      expect(
        (await fetch(`${app.base}/v1/renders/unknown/frame.jpg?n=0`)).status,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it('isolates render clock from agent pause and fences WS resume/interrupt', async () => {
    const app = await setup();
    try {
      const session = await create(app.client);
      const ws = new WebSocket(session.wsUrl);
      await new Promise<void>((r) => ws.once('open', r));
      ws.send(JSON.stringify({ t: 'pause' }));
      await wait(10);
      const version = (await app.client.session(session.sessionId)).project
        .version;
      const { renderId } = await app.client.approve(session.sessionId, {
        expectedProjectVersion: version,
      });
      ws.send(JSON.stringify({ t: 'resume' }));
      ws.send(JSON.stringify({ t: 'interrupt', text: 'slower' }));
      await wait(280);
      expect((await app.client.render(renderId)).status).toBe('done');
      expect(
        (await app.client.session(session.sessionId)).project.version,
      ).toBe(version);
      ws.close();
    } finally {
      await app.close();
    }
  });
  it('reports failure with error, permits terminal reopen/retry and enforces expiry', async () => {
    const app = await setup({ fail: 'render' });
    try {
      const { sessionId } = await create(app.client);
      await expect(app.client.reopenSession(sessionId)).rejects.toMatchObject({
        status: 409,
      });
      const first = await app.client.approve(sessionId);
      await wait(280);
      expect(await app.client.render(first.renderId)).toMatchObject({
        status: 'failed',
        error: { message: 'simulated synthetic render failure' },
      });
      await app.client.reopenSession(sessionId);
      expect((await app.client.approve(sessionId)).renderId).not.toBe(
        first.renderId,
      );
    } finally {
      await app.close();
    }
    const expired = await setup({ editTtlMs: 1 });
    try {
      const { sessionId } = await create(expired.client);
      await wait(10);
      await expect(
        expired.client.reopenSession(sessionId),
      ).rejects.toMatchObject({ status: 410 });
      await expect(expired.client.approve(sessionId)).rejects.toMatchObject({
        status: 410,
      });
    } finally {
      await expired.close();
    }
  });
  it('approve freezes an actually held agent step before any later commit', async () => {
    const app = await setup({ stepDurationMs: 200 });
    try {
      const session = await create(app.client);
      const ws = new WebSocket(session.wsUrl);
      await new Promise<void>((accept, reject) => {
        const timer = setTimeout(
          () => reject(new Error('held action timeout')),
          1500,
        );
        ws.on('message', (bytes: Buffer) => {
          const event: unknown = JSON.parse(bytes.toString());
          if (
            event &&
            typeof event === 'object' &&
            't' in event &&
            event.t === 'agent.action.start'
          ) {
            clearTimeout(timer);
            accept();
          }
        });
      });
      const before = await app.client.session(session.sessionId);
      const { renderId } = await app.client.approve(session.sessionId, {
        expectedProjectVersion: before.project.version,
      });
      await expect(
        app.client.reopenSession(session.sessionId),
      ).rejects.toMatchObject({ status: 409 });
      for (const endpoint of [
        `renders/${renderId}/cancel`,
        `sessions/${session.sessionId}/reopen`,
      ]) {
        expect(
          (
            await fetch(`${app.base}/v1/${endpoint}`, {
              method: 'POST',
              body: '{"unexpected":true}',
            })
          ).status,
        ).toBe(400);
      }
      await wait(280);
      expect((await app.client.session(session.sessionId)).project).toEqual(
        before.project,
      );
      expect((await app.client.render(renderId)).status).toBe('done');
      ws.close();
    } finally {
      await app.close();
    }
  });
  it('fixture bytes prove portrait dimensions, duration and absent audio, not composition', () => {
    const output: unknown = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,width,height:format=duration',
          '-of',
          'json',
          'packages/mock-server/fixtures/portrait.mp4',
        ],
        { encoding: 'utf8' },
      ),
    );
    expect(output).toMatchObject({
      streams: [{ codec_type: 'video', width: 1080, height: 1920 }],
      format: { duration: '8.000000' },
    });
    if (
      !output ||
      typeof output !== 'object' ||
      !('streams' in output) ||
      !Array.isArray(output.streams)
    )
      throw new Error('missing probe');
    expect(output.streams).toHaveLength(1);
  });
});
describe('Phase 9 gateway exact allowlist', () => {
  it('permits only named routes and methods, preserving query', () => {
    for (const path of [
      '/render/s',
      '/v/v',
      '/mock-api/v1/renders/r/frame.jpg?n=12',
      '/mock-api/fixtures/portrait.mp4',
      '/mock-api/fixtures/frame-portrait.jpg',
    ])
      for (const method of ['GET', 'HEAD'])
        expect(route(path, method)?.path).toBe(path.replace('/mock-api', ''));
    for (const path of [
      '/mock-api/v1/renders/r/cancel',
      '/mock-api/v1/sessions/s/reopen',
    ]) {
      expect(route(path, 'POST')).not.toBeNull();
      for (const method of ['GET', 'HEAD', 'PUT', 'DELETE'])
        expect(route(path, method)).toBeNull();
    }
    for (const path of [
      '/render/s/extra',
      '/v/v/extra',
      '/render/a%2Fb',
      '/v/../s',
      '/mock-api/v1/renders/r/frame.jpg/extra',
      '/mock-api/fixtures/arbitrary.jpg',
      '/mock-api/v1/renders/r/frame%2ejpg',
    ])
      expect(route(path)).toBeNull();
    expect(route('/mock-api/v1/renders/r/frame.jpg?n=1', 'POST')).toBeNull();
    expect(route('/v/v', 'POST')).toBeNull();
  });
});
