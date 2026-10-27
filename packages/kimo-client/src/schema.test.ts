import { describe, it, expect } from 'vitest';
import * as s from './schema';
import { applyOps } from './ops';
export const sampleProject: s.KimoProject = {
  id: 'p',
  version: 0,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 0,
  tracks: [],
  clips: {},
  markers: [],
};
export const sampleClip: s.Clip = {
  id: 'c',
  trackId: 'v1',
  kind: 'video',
  start: 0,
  duration: 8,
  in: 0,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  effects: [],
  keyframes: [],
  speed: 1,
};
describe('all contracts', () => {
  it('parses project,asset,upload,session,render,video payloads', () => {
    expect(s.projectSchema.parse(sampleProject)).toEqual(sampleProject);
    s.assetSchema.parse({
      id: 'a',
      kind: 'video',
      name: 'clip',
      url: '/a',
      source: 'user',
    });
    s.uploadRequestSchema.parse({
      files: [{ name: 'a', size: 1, mime: 'video/mp4' }],
    });
    s.uploadResponseSchema.parse({
      uploads: [
        {
          assetId: 'a',
          putUrl: '/put',
          headers: {},
          parts: [{ partNumber: 1, putUrl: '/part' }],
        },
      ],
    });
    s.sessionRequestSchema.parse({
      prompt: 'cut',
      assetIds: [],
      aspect: 'auto',
    });
    s.sessionResponseSchema.parse({ sessionId: 's', wsUrl: 'ws://localhost' });
    s.sessionSnapshotSchema.parse({
      status: 'warming',
      project: sampleProject,
      assets: [],
    });
    s.renderSchema.parse({
      status: 'done',
      progress: 1,
      frame: 1,
      totalFrames: 1,
      etaSec: 0,
    });
    s.videoSchema.parse({
      url: '/v',
      posterUrl: '/p',
      durationSec: 8,
      width: 1920,
      height: 1080,
      sizeBytes: 1,
      title: 'test',
    });
    s.approvalResponseSchema.parse({ renderId: 'r' });
    s.messageRequestSchema.parse({ text: 'slower' });
    s.opsRequestSchema.parse({ ops: [], baseVersion: 0 });
    s.versionResponseSchema.parse({ version: 1 });
    s.completeRequestSchema.parse({ parts: [{ partNumber: 1, etag: 'etag' }] });
  });
  it('accepts optional recorded action IDs without inventing legacy history', () => {
    const legacy: s.SessionSnapshot = {
      status: 'awaiting_review',
      project: { ...sampleProject, version: 99 },
      assets: [],
    };
    expect(s.sessionSnapshotSchema.parse(legacy)).toEqual(legacy);
    expect(s.sessionSnapshotSchema.parse(legacy).actionIds).toBeUndefined();
    for (const actionIds of [[], ['recorded-a', 'recorded-b']]) {
      const snapshot: s.SessionSnapshot = { ...legacy, actionIds };
      expect(s.sessionSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    }
    for (const actionIds of [null, 2, 'recorded-a', [1], ['']])
      expect(
        s.sessionSnapshotSchema.safeParse({ ...legacy, actionIds }).success,
      ).toBe(false);
  });
  const ops: s.Op[] = [
    { op: 'clip.add', clip: sampleClip },
    { op: 'clip.update', id: 'c', patch: { volume: 0.5 } },
    { op: 'clip.move', id: 'c', trackId: 'v1', start: 0 },
    { op: 'clip.trim', id: 'c', edge: 'out', value: 7 },
    { op: 'clip.split', id: 'c', at: 3, newId: 'c2' },
    {
      op: 'track.add',
      track: {
        id: 'v1',
        kind: 'video',
        name: 'video',
        muted: false,
        hidden: false,
        locked: false,
        height: 64,
      },
    },
    { op: 'track.update', id: 'v1', patch: { muted: true } },
    { op: 'text.update', clipId: 'c', content: 'hello' },
    {
      op: 'effect.set',
      clipId: 'c',
      effect: { id: 'grade', kind: 'grade', params: { contrast: 1.1 } },
    },
    {
      op: 'keyframe.set',
      clipId: 'c',
      keyframe: { property: 'opacity', time: 0, value: 1 },
    },
    { op: 'marker.add', marker: { id: 'm', time: 0, label: 'intro' } },
    { op: 'clip.remove', id: 'c2' },
  ];
  for (const op of ops)
    it(`parses ${op.op}`, () => {
      expect(s.opSchema.parse(op)).toEqual(op);
    });
  it('applies every operation immutably', () => {
    const result = applyOps(sampleProject, ops);
    expect(result.version).toBe(1);
    expect(result.clips.c?.duration).toBe(3);
    expect(result.tracks[0]?.muted).toBe(true);
    expect(result.clips.c2).toBeUndefined();
    expect(sampleProject.version).toBe(0);
  });
  it('validates all server event variants', () => {
    const events: s.ServerEvent[] = [
      { t: 'hello', version: 0 },
      { t: 'agent.status', state: 'thinking', label: 'reading' },
      {
        t: 'agent.action.start',
        id: 'a',
        tool: 'trim',
        title: 'trim',
        args: {},
      },
      { t: 'agent.action.progress', id: 'a', pct: 0.5 },
      { t: 'agent.action.end', id: 'a', ok: true, durationMs: 5 },
      { t: 'project.ops', version: 1, ops: [] },
      {
        t: 'agent.message',
        id: 'm',
        role: 'agent',
        text: 'ready',
        kind: 'ask_review',
      },
      {
        t: 'asset.added',
        asset: {
          id: 'a',
          kind: 'image',
          name: 'image',
          url: '/a',
          source: 'web',
          attribution: {
            site: 'original fixture',
            pageUrl: 'https://github.com/naman-sharma12345/kimo-web',
            license: 'CC0-1.0',
          },
        },
      },
      {
        t: 'sam.mask',
        clipId: 'c',
        maskAssetId: 'mask',
        previewPolygon: [
          [0, 0],
          [1, 1],
        ],
      },
      { t: 'warmup.step', step: 'ready', pct: 1 },
      { t: 'error', code: 'MOCK', message: 'failed' },
    ];
    for (const event of events)
      expect(s.serverEventSchema.parse(event)).toEqual(event);
  });
  it('rejects invalid version/progress and client packets', () => {
    expect(
      s.renderSchema.safeParse({ status: 'done', progress: 2 }).success,
    ).toBe(false);
    for (const event of [
      { t: 'interrupt', text: 'slower' },
      { t: 'pause' },
      { t: 'resume' },
      { t: 'ping' },
    ])
      expect(s.clientEventSchema.safeParse(event).success).toBe(true);
  });
});
