// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { KimoClient, serverEventSchema, type ServerEvent } from '@kimo/client';
import { createMockServer } from './index';

describe('process-lifetime recorded presentation history', () => {
  it('records HTTP-produced replies with no browser/socket and does not invent action history from edits', async () => {
    const dataDir = await mkdtemp(resolve(process.cwd(), '.history-test-'));
    const mock = createMockServer({
      port: 0,
      speed: 1000,
      stepDurationMs: 0,
      dataDir,
    });
    try {
      const client = new KimoClient(await mock.start());
      const session = await client.createSession({
        prompt: 'original',
        assetIds: [],
        aspect: 'auto',
      });
      expect((await client.session(session.sessionId)).agentHistory).toEqual(
        [],
      );
      await client.message(session.sessionId, 'adjust this');
      const snapshot = await client.session(session.sessionId);
      expect(snapshot.agentHistory?.map((event) => event.t)).toEqual([
        'agent.status',
        'agent.message',
        'agent.message',
        'agent.message',
      ]);
      expect(snapshot.agentHistory?.[0]).toMatchObject({
        label: 'reading your note',
      });
      expect(snapshot.actionIds).toEqual([]);
      expect(snapshot.project.version).toBe(0);
    } finally {
      await mock.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
  it('records actual action starts/ends while disconnected and exposes only the presentation subset', async () => {
    const dataDir = await mkdtemp(resolve(process.cwd(), '.history-test-'));
    const mock = createMockServer({
      port: 0,
      speed: 1000,
      stepDurationMs: 2,
      dataDir,
    });
    try {
      const client = new KimoClient(await mock.start());
      const session = await client.createSession({
        prompt: 'original',
        assetIds: [],
        aspect: 'auto',
      });
      const ws = new WebSocket(session.wsUrl);
      const observed: ServerEvent[] = [];
      await new Promise<void>((done, reject) => {
        const timer = setTimeout(
          () => reject(new Error('first action timeout')),
          3000,
        );
        ws.on('error', reject);
        ws.on('message', (raw) => {
          const event = serverEventSchema.parse(JSON.parse(raw.toString()));
          observed.push(event);
          if (event.t === 'agent.action.start') {
            clearTimeout(timer);
            ws.close();
          }
        });
        ws.on('close', () => done());
      });
      // Existing bounded fixture runner continues with no connected consumer.
      await new Promise<void>((done) => setTimeout(done, 250));
      const snapshot = await client.session(session.sessionId);
      const history = snapshot.agentHistory ?? [];
      const starts = history.filter(
        (event) => event.t === 'agent.action.start',
      );
      expect(starts.length).toBeGreaterThan(
        observed.filter((event) => event.t === 'agent.action.start').length,
      );
      expect(snapshot.actionIds).toEqual(starts.map((event) => event.id));
      expect(history).toContainEqual(
        observed.find((event) => event.t === 'agent.action.start'),
      );
      for (const start of starts) {
        expect(
          history.findIndex(
            (event) => event.t === 'agent.action.end' && event.id === start.id,
          ),
        ).toBeGreaterThan(history.indexOf(start));
      }
      expect(
        history.some(
          (event) => event.t === 'agent.message' && event.kind === 'ask_review',
        ),
      ).toBe(true);
      expect(
        history.every((event) =>
          [
            'agent.status',
            'agent.action.start',
            'agent.action.end',
            'agent.message',
            'error',
          ].includes(event.t),
        ),
      ).toBe(true);
      expect((await client.session(session.sessionId)).agentHistory).toEqual(
        history,
      );
    } finally {
      await mock.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
