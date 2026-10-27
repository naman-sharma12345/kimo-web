// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { KimoClient, serverEventSchema, type ServerEvent } from '@kimo/client';
import { createMockServer } from './index';
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
async function setup() {
  const dataDir = await mkdtemp(resolve(process.cwd(), '.phase8-mock-'));
  const mock = createMockServer({
    port: 0,
    speed: 1000,
    stepDurationMs: 80,
    dataDir,
  });
  const base = await mock.start();
  const client = new KimoClient(base);
  const session = await client.createSession({
    prompt: 'synthetic',
    assetIds: [],
    aspect: 'auto',
  });
  const events: ServerEvent[] = [];
  const ws = new WebSocket(session.wsUrl);
  ws.on('message', (raw) =>
    events.push(serverEventSchema.parse(JSON.parse(raw.toString()))),
  );
  function waitFor(predicate: (event: ServerEvent) => boolean) {
    return new Promise<ServerEvent>((accept, reject) => {
      const existing = events.find(predicate);
      if (existing) {
        accept(existing);
        return;
      }
      const timer = setTimeout(() => {
        ws.off('message', listener);
        reject(new Error('Phase 8 stream timeout'));
      }, 4000);
      const listener = (raw: Buffer) => {
        const event = serverEventSchema.parse(JSON.parse(raw.toString()));
        if (predicate(event)) {
          clearTimeout(timer);
          ws.off('message', listener);
          accept(events.find(predicate) ?? event);
        }
      };
      ws.on('message', listener);
    });
  }
  return {
    client,
    session,
    events,
    ws,
    waitFor,
    async close() {
      await mock.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
describe('Phase 8 real HTTP/WebSocket held actions', () => {
  it('ACKs within 400ms after safe end, starts a new response and supersedes stale script', async () => {
    const app = await setup();
    try {
      const start = await app.waitFor(
        (e) => e.t === 'agent.action.start' && e.tool === 'trim_clip',
      );
      if (start.t !== 'agent.action.start') throw new Error('expected start');
      const before = Date.now();
      app.ws.send(
        JSON.stringify({
          t: 'interrupt',
          text: 'slower',
          clientMessageId: 'note-1',
        }),
      );
      const ack = await app.waitFor(
        (e) => e.t === 'agent.status' && e.label === 'reading your note',
      );
      expect(Date.now() - before).toBeLessThanOrEqual(400);
      expect(ack).toMatchObject({ inReplyTo: 'note-1' });
      const safeEnd = app.events.find(
        (e) => e.t === 'agent.action.end' && e.id === start.id,
      );
      expect(safeEnd).toMatchObject({ ok: true });
      expect(app.events.indexOf(safeEnd as ServerEvent)).toBeLessThan(
        app.events.indexOf(ack),
      );
      const response = await app.waitFor(
        (e) => e.t === 'agent.action.start' && e.tool === 'respond_to_note',
      );
      expect(response).toMatchObject({
        target: { clipId: 'c1', trackId: 'v1', time: 0 },
      });
      await app.waitFor(
        (e) => e.t === 'agent.message' && e.stream?.done === true,
      );
      await sleep(100);
      const ackIndex = app.events.indexOf(ack);
      expect(
        app.events
          .slice(ackIndex)
          .filter((e) => e.t === 'agent.action.start')
          .every(
            (e) => e.t === 'agent.action.start' && e.tool === 'respond_to_note',
          ),
      ).toBe(true);
      expect(
        app.events.some(
          (e) => e.t === 'agent.message' && e.kind === 'ask_choice',
        ),
      ).toBe(true);
      expect(
        (await app.client.session(app.session.sessionId)).project.clips.c1
          ?.speed,
      ).toBe(0.8);
    } finally {
      await app.close();
    }
  });
  it('hard pause cancels normal completion and paused interrupts, then cancels response completion too', async () => {
    const app = await setup();
    try {
      const start = await app.waitFor(
        (e) => e.t === 'agent.action.start' && e.tool === 'trim_clip',
      );
      app.ws.send(JSON.stringify({ t: 'pause' }));
      await app.waitFor((e) => e.t === 'agent.status' && e.label === 'paused');
      const paused = await app.client.session(app.session.sessionId);
      const count = app.events.length;
      app.ws.send(
        JSON.stringify({
          t: 'interrupt',
          text: 'slower',
          clientMessageId: 'paused-note',
        }),
      );
      await sleep(180);
      expect(
        (await app.client.session(app.session.sessionId)).project.version,
      ).toBe(paused.project.version);
      expect(
        app.events
          .slice(count)
          .some(
            (e) => e.t === 'agent.status' && e.label === 'reading your note',
          ),
      ).toBe(false);
      expect(
        app.events.find(
          (e) =>
            e.t === 'agent.action.end' &&
            start.t === 'agent.action.start' &&
            e.id === start.id,
        ),
      ).toMatchObject({ ok: false, error: 'stopped by pause' });
      app.ws.send(JSON.stringify({ t: 'resume' }));
      const response = await app.waitFor(
        (e) => e.t === 'agent.action.start' && e.tool === 'respond_to_note',
      );
      const lastPause = app.events.length;
      app.ws.send(JSON.stringify({ t: 'pause' }));
      await new Promise<void>((accept, reject) => {
        const timer = setTimeout(
          () => reject(new Error('second pause timeout')),
          1000,
        );
        const listener = (raw: Buffer) => {
          const e = serverEventSchema.parse(JSON.parse(raw.toString()));
          if (e.t === 'agent.status' && e.label === 'paused') {
            clearTimeout(timer);
            app.ws.off('message', listener);
            accept();
          }
        };
        app.ws.on('message', listener);
      });
      const stopped = await app.client.session(app.session.sessionId);
      await sleep(180);
      expect(
        (await app.client.session(app.session.sessionId)).project.version,
      ).toBe(stopped.project.version);
      expect(
        app.events.slice(lastPause).some((e) => e.t === 'agent.message'),
      ).toBe(false);
      expect(
        app.events.find(
          (e) =>
            e.t === 'agent.action.end' &&
            response.t === 'agent.action.start' &&
            e.id === response.id,
        ),
      ).toMatchObject({ error: 'stopped by pause' });
      app.ws.send(JSON.stringify({ t: 'resume' }));
      await app.waitFor(
        (e) => e.t === 'agent.message' && e.stream?.done === true,
      );
      expect(
        (await app.client.session(app.session.sessionId)).project.version,
      ).toBeGreaterThan(stopped.project.version);
    } finally {
      await app.close();
    }
  });
  it('preserves the 45-action fixture with explicit web/SAM metadata and supplied results', async () => {
    const dataDir = await mkdtemp(resolve(process.cwd(), '.phase8-fixture-'));
    const mock = createMockServer({ port: 0, speed: 1000, dataDir });
    try {
      const client = new KimoClient(await mock.start());
      const session = await client.createSession({
        prompt: 'test',
        assetIds: [],
        aspect: 'auto',
      });
      const events: ServerEvent[] = [];
      const ws = new WebSocket(session.wsUrl);
      await new Promise<void>((accept, reject) => {
        const timer = setTimeout(
          () => reject(new Error('fixture timeout')),
          3000,
        );
        ws.on('message', (raw) => {
          const e = serverEventSchema.parse(JSON.parse(raw.toString()));
          events.push(e);
          if (e.t === 'agent.message' && e.kind === 'ask_review') {
            clearTimeout(timer);
            accept();
          }
        });
      });
      expect(events.filter((e) => e.t === 'agent.action.start')).toHaveLength(
        45,
      );
      const web = events.find(
        (e) => e.t === 'asset.added' && e.asset.source === 'web',
      );
      expect(web?.t === 'asset.added' && web.actionId).toBeTruthy();
      if (web?.t !== 'asset.added') throw new Error('missing web');
      const action = events.find(
        (e) => e.t === 'agent.action.start' && e.id === web.actionId,
      );
      expect(action).toMatchObject({
        tool: 'add_web_image',
        target: { clipId: 'web-image' },
      });
      expect(events.indexOf(action as ServerEvent)).toBeLessThan(
        events.indexOf(web),
      );
      expect(events.find((e) => e.t === 'sam.mask')).toMatchObject({
        subjectLabel: 'synthetic ellipse',
        coordinateSpace: 'source_uv',
      });
      expect(
        events
          .filter((e) => e.t === 'agent.action.end')
          .every((e) => e.t === 'agent.action.end' && e.resultSummary),
      ).toBe(true);
      ws.close();
    } finally {
      await mock.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
