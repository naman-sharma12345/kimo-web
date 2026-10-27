import { describe, expect, it } from 'vitest';
import { agentHistoryEventSchema, sessionSnapshotSchema } from './schema';
const snapshot = {
  status: 'editing',
  project: {
    id: 'p',
    version: 0,
    fps: 30,
    width: 1920,
    height: 1080,
    duration: 0,
    tracks: [],
    clips: {},
    markers: [],
  },
  assets: [],
};
describe('optional presentation history contract', () => {
  it('keeps legacy absence and validates an ordered actual event log', () => {
    expect(sessionSnapshotSchema.parse(snapshot)).not.toHaveProperty(
      'agentHistory',
    );
    const agentHistory = [
      { t: 'agent.status', state: 'acting', label: 'working' },
      {
        t: 'agent.action.start',
        id: 'a',
        tool: 'trim',
        title: 'trim',
        args: {},
      },
      { t: 'agent.action.progress', id: 'a', pct: 0.5 },
      { t: 'agent.action.end', id: 'a', ok: true, durationMs: 1 },
      {
        t: 'asset.added',
        asset: {
          id: 'web',
          kind: 'image',
          source: 'web',
          name: 'image',
          url: '/image.jpg',
        },
      },
      { t: 'sam.mask', clipId: 'c', maskAssetId: 'm', previewPolygon: [] },
      {
        t: 'agent.message',
        id: 'm',
        role: 'agent',
        kind: 'ask_review',
        text: 'review',
      },
      { t: 'error', code: 'E', message: 'recorded error' },
    ];
    expect(
      sessionSnapshotSchema.parse({ ...snapshot, agentHistory }).agentHistory,
    ).toEqual(agentHistory);
  });
  it('rejects mutation, transport, warmup and malformed history entries', () => {
    for (const event of [
      { t: 'project.ops', version: 1, ops: [] },
      { t: 'hello', version: 0 },
      { t: 'asset.added', asset: {} },
      { t: 'agent.action.progress', id: 'a', pct: 2 },
      { t: 'sam.mask', clipId: '', maskAssetId: 'm', previewPolygon: [] },
      { t: 'warmup.step', step: 'ready', pct: 1 },
      { t: 'agent.action.start', id: '', args: {} },
    ]) {
      expect(agentHistoryEventSchema.safeParse(event).success).toBe(false);
      expect(
        sessionSnapshotSchema.safeParse({ ...snapshot, agentHistory: [event] })
          .success,
      ).toBe(false);
    }
  });
});
