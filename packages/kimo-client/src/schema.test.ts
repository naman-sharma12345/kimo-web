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

describe('additive Phase 6 contracts', () => {
  it('preserves all eight styles and old aliases across snapshots and patches', () => {
    for (const style of s.textStyleIdSchema.options) {
      const clip = {
        ...sampleClip,
        text: { style, content: 'hello', secondaryContent: 'world' },
      };
      expect(s.clipSchema.parse(clip)).toEqual(clip);
      expect(
        s.opSchema.parse({
          op: 'clip.update',
          id: 'c',
          patch: { text: clip.text },
        }),
      ).toEqual({ op: 'clip.update', id: 'c', patch: { text: clip.text } });
    }
  });
  it('accepts every transition kind and direction, frame-only and legacy seconds', () => {
    for (const kind of ['cut', 'crossfade', 'dip', 'slide', 'zoom_in', 'whip'])
      for (const direction of ['left', 'right', 'up', 'down']) {
        const transition = {
          kind,
          direction,
          duration: 0.5,
          durationFrames: 15,
        };
        expect(s.transitionSchema.parse(transition)).toEqual(transition);
      }
    expect(
      s.transitionSchema.parse({ kind: 'crossfade', duration: 1 }).duration,
    ).toBe(1);
    expect(
      s.transitionSchema.parse({ kind: 'whip', durationFrames: 0 })
        .durationFrames,
    ).toBe(0);
    for (const invalid of [
      {},
      { duration: 0.5, durationFrames: 30 },
      { durationFrames: -1 },
      { durationFrames: 1.2 },
    ])
      expect(
        s.transitionSchema.safeParse({ kind: 'slide', ...invalid }).success,
      ).toBe(false);
  });
  it('requires finite bezier handles and bounded x, while allowing y overshoot', () => {
    const key = {
      property: 'x',
      time: 0,
      value: 1,
      easing: 'bezier',
      bezier: [0.2, -0.5, 0.8, 1.5],
    };
    expect(s.keyframeSchema.parse(key)).toEqual(key);
    expect(
      s.keyframeSchema.parse({ ...key, easing: 'hold', bezier: undefined })
        .easing,
    ).toBe('hold');
    for (const bezier of [
      undefined,
      [-0.1, 0, 1, 1],
      [0, 0, 1.1, 1],
      [0, Infinity, 1, 1],
      [0, 1],
    ])
      expect(s.keyframeSchema.safeParse({ ...key, bezier }).success).toBe(
        false,
      );
    expect(
      s.keyframeSchema.safeParse({ ...key, easing: 'linear' }).success,
    ).toBe(false);
  });
  it('validates explicit bounded shape payloads without requiring legacy shape geometry', () => {
    const rect = {
      kind: 'rect',
      width: 400,
      height: 40,
      radius: 8,
      fill: [0, 0, 0, 0.7],
    };
    const line = {
      kind: 'line',
      x1: -10,
      y1: 0,
      x2: 10,
      y2: 20,
      stroke: [1, 1, 1, 1],
      strokeWidth: 2,
    };
    for (const shape of [rect, line])
      expect(s.shapeSchema.parse(shape)).toEqual(shape);
    expect(
      s.clipSchema.safeParse({ ...sampleClip, kind: 'shape' }).success,
    ).toBe(true);
    expect(
      s.shapeSchema.safeParse({ ...rect, fill: [2, 0, 0, 1] }).success,
    ).toBe(false);
    expect(s.shapeSchema.safeParse({ ...line, strokeWidth: 0 }).success).toBe(
      false,
    );
  });
  it('types mask encodings, exact RLE coverage and LUT atlas metadata', () => {
    const base = {
      width: 2,
      height: 2,
      coordinateSpace: 'source_uv',
      channel: 'luma',
    };
    for (const metadata of [
      { ...base, encoding: 'rle', fps: 30, version: 1, payloadUrl: '/runs' },
      { ...base, encoding: 'video', fps: 24, timeOrigin: 2 },
      { ...base, encoding: 'luma_image' },
    ])
      expect(s.maskMetadataSchema.parse(metadata)).toEqual(metadata);
    const frame = { frameIndex: 0, width: 2, height: 2, counts: [0, 2, 2] };
    expect(s.maskRleFrameSchema.parse(frame)).toEqual(frame);
    for (const counts of [[1], [2, 3], [-1, 5], [1.5, 2.5], []])
      expect(s.maskRleFrameSchema.safeParse({ ...frame, counts }).success).toBe(
        false,
      );
    expect(
      s.maskMetadataSchema.safeParse({ ...base, encoding: 'rle', fps: 0 })
        .success,
    ).toBe(false);
    expect(
      s.lutMetadataSchema.parse({
        size: 64,
        layout: 'tiles_8x8',
        colorSpace: 'srgb',
      }).size,
    ).toBe(64);
    expect(
      s.lutMetadataSchema.safeParse({
        size: 32,
        layout: 'strip',
        colorSpace: 'srgb',
      }).success,
    ).toBe(false);
  });
  it('preserves mask/LUT metadata in asset events and scoped effects in ops', () => {
    const asset = {
      id: 'mask',
      kind: 'image',
      name: 'mask',
      url: '/mask',
      source: 'user',
      mask: {
        encoding: 'luma_image',
        width: 2,
        height: 2,
        coordinateSpace: 'source_uv',
        channel: 'red',
      },
      lut: { size: 64, layout: 'tiles_8x8', colorSpace: 'srgb' },
    };
    expect(s.serverEventSchema.parse({ t: 'asset.added', asset })).toEqual({
      t: 'asset.added',
      asset,
    });
    for (const scope of ['all', 'inside_mask', 'outside_mask']) {
      const op = {
        op: 'effect.set',
        clipId: 'c',
        effect: { id: 'e', kind: 'blur', params: { sigma: 3 }, scope },
      };
      expect(s.opSchema.parse(op)).toEqual(op);
    }
  });
  it('retains optional action target timing and explicit SAM correlation without changing action IDs', () => {
    const target = {
      clipId: 'c',
      time: 2,
      previewPolygon: [
        [0, 0],
        [1, 1],
      ],
      subjectLabel: 'person',
      coordinateSpace: 'source_uv',
    };
    const event = {
      t: 'agent.action.start',
      id: 'same-phase5-id',
      tool: 'sam',
      title: 'mask',
      args: {},
      target,
    };
    expect(s.serverEventSchema.parse(event)).toEqual(event);
    const mask = {
      t: 'sam.mask',
      actionId: event.id,
      subjectLabel: 'person',
      coordinateSpace: 'source_uv',
      clipId: 'c',
      maskAssetId: 'm',
      previewPolygon: target.previewPolygon,
    };
    expect(s.serverEventSchema.parse(mask)).toEqual(mask);
    expect(
      s.serverEventSchema.safeParse({ ...event, target: { time: -1 } }).success,
    ).toBe(false);
  });
  it('keeps role/solo/animation defaults optional and validates their patches', () => {
    expect(s.clipSchema.parse(sampleClip).animationOffsetSec).toBeUndefined();
    for (const role of ['voice', 'music', 'other']) {
      const op = {
        op: 'clip.update',
        id: 'c',
        patch: { audioRole: role, animationOffsetSec: 2 },
      };
      expect(s.opSchema.parse(op)).toEqual(op);
    }
    const op = { op: 'track.update', id: 'v', patch: { solo: true } };
    expect(s.opSchema.parse(op)).toEqual(op);
  });
});
