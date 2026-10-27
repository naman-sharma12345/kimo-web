import type { KimoProject, Clip, ServerEvent, ClientEvent, Op } from './schema';
export const project: KimoProject = {
  id: 'p',
  version: 0,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 8,
  tracks: [],
  clips: {},
  markers: [],
};
export const clip: Clip = {
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
export const asset = {
  id: 'a',
  kind: 'video',
  name: 'fixture',
  url: '/fixture.mp4',
  source: 'user',
} as const;
export const serverFixtures = {
  hello: { t: 'hello', version: 0 },
  'agent.status': { t: 'agent.status', state: 'idle', label: '' },
  'agent.action.start': {
    t: 'agent.action.start',
    id: 'action',
    tool: 'fixture',
    title: '',
    args: {},
  },
  'agent.action.progress': {
    t: 'agent.action.progress',
    id: 'action',
    pct: 0.5,
  },
  'agent.action.end': {
    t: 'agent.action.end',
    id: 'action',
    ok: true,
    durationMs: 1,
  },
  'project.ops': { t: 'project.ops', version: 1, ops: [] },
  'agent.message': {
    t: 'agent.message',
    id: 'message',
    role: 'agent',
    text: '',
    kind: 'say',
  },
  'asset.added': { t: 'asset.added', asset },
  'sam.mask': {
    t: 'sam.mask',
    clipId: 'c',
    maskAssetId: 'm',
    previewPolygon: [],
  },
  'warmup.step': { t: 'warmup.step', step: 'upload', pct: 0 },
  error: { t: 'error', code: 'fixture', message: '' },
} satisfies Record<ServerEvent['t'], ServerEvent>;
export const clientFixtures = {
  interrupt: { t: 'interrupt', text: 'fixture' },
  pause: { t: 'pause' },
  resume: { t: 'resume' },
  ping: { t: 'ping' },
} satisfies Record<ClientEvent['t'], ClientEvent>;
export const opFixtures = {
  'project.update': { op: 'project.update', patch: { notes: '' } },
  'clip.add': { op: 'clip.add', clip },
  'clip.update': { op: 'clip.update', id: 'c', patch: { start: 1 } },
  'clip.remove': { op: 'clip.remove', id: 'c' },
  'clip.move': { op: 'clip.move', id: 'c', trackId: 'v1', start: 1 },
  'clip.trim': { op: 'clip.trim', id: 'c', edge: 'in', value: 1 },
  'clip.split': { op: 'clip.split', id: 'c', at: 1, newId: 'right' },
  'track.add': {
    op: 'track.add',
    track: {
      id: 'v1',
      kind: 'video',
      name: 'v1',
      muted: false,
      hidden: false,
      locked: false,
      height: 64,
    },
  },
  'track.remove': { op: 'track.remove', id: 'v1' },
  'track.update': { op: 'track.update', id: 'v1', patch: { name: '' } },
  'text.update': { op: 'text.update', clipId: 'c', content: '' },
  'effect.set': {
    op: 'effect.set',
    clipId: 'c',
    effect: { id: 'e', kind: 'fixture', params: {} },
  },
  'keyframe.set': {
    op: 'keyframe.set',
    clipId: 'c',
    keyframe: { property: 'x', time: 0, value: 0 },
  },
  'marker.add': { op: 'marker.add', marker: { id: 'm', time: 0, label: '' } },
} satisfies Record<Op['op'], Op>;
