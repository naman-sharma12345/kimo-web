import {
  projectSchema,
  sessionSnapshotSchema,
  renderSchema,
  videoSchema,
  serverEventSchema,
} from '../packages/kimo-client/src/schema';

/** Synthetic schema fixtures, not production captures or engine output. */
export const fixtureOrigin = 'http://127.0.0.1:8791';
export const longTitle = 'synthetic long project title '.repeat(7).trim();
export const project = projectSchema.parse({
  id: 'phase10-project',
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 8,
  tracks: [
    {
      id: 'titles',
      kind: 'text',
      name: 'titles',
      muted: false,
      hidden: false,
      locked: false,
      height: 64,
    },
  ],
  clips: {
    title: {
      id: 'title',
      trackId: 'titles',
      kind: 'text',
      start: 0,
      duration: 8,
      in: 0,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      text: { content: 'synthetic title', style: 'title' },
      effects: [],
      keyframes: [],
      speed: 1,
    },
  },
  markers: [],
});
export function snapshot(id: string) {
  const warming = id.startsWith('warmup');
  const rendering = id.startsWith('render');
  const empty = id === 'studio-empty';
  return sessionSnapshotSchema.parse({
    status: warming ? 'warming' : rendering ? 'rendering' : 'editing',
    project: empty
      ? { ...project, tracks: [], clips: {}, duration: 0 }
      : project,
    assets: [],
    actionIds: empty || warming ? [] : ['fixture-action'],
    title: id.endsWith('long') ? longTitle : 'synthetic title',
    renderId: rendering ? id : undefined,
    wsUrl: `ws://127.0.0.1:8791/live/${id}`,
  });
}
export function render(id: string) {
  return renderSchema.parse({
    status:
      id === 'render-failed'
        ? 'failed'
        : id === 'render-queued'
          ? 'queued'
          : 'rendering',
    sessionId: id,
    progress: id === 'render-queued' ? 0 : 0.5,
    frame: id === 'render-queued' ? 0 : 120,
    totalFrames: 240,
    etaSec: 4,
    fps: 30,
    error:
      id === 'render-failed'
        ? { message: 'synthetic render failure' }
        : undefined,
  });
}
export function video(id: string) {
  return videoSchema.parse({
    title: id.endsWith('long') ? longTitle : 'synthetic title',
    url: `${fixtureOrigin}/fixtures/clip-1.mp4`,
    posterUrl: `${fixtureOrigin}/fixtures/frame-landscape.jpg`,
    durationSec: 8,
    width: 1920,
    height: 1080,
    sizeBytes: 8011107,
    downloadExpiresAt:
      id === 'video-expired-download' ? '2020-01-01T00:00:00Z' : undefined,
    history: [],
  });
}
export function events(id: string) {
  return [
    { t: 'hello', version: 1 },
    ...(id.startsWith('warmup')
      ? [
          { t: 'warmup.step', step: 'watch', pct: 0.5 },
          {
            t: 'agent.status',
            state: 'thinking',
            label: 'synthetic fixture: watching',
          },
        ]
      : [
          {
            t: 'agent.status',
            state: 'idle',
            label: 'synthetic fixture: waiting',
          },
          {
            t: 'agent.message',
            id: 'fixture-message',
            role: 'agent',
            kind: 'say',
            text: 'synthetic fixture, not an engine response',
          },
        ]),
    ...(id === 'warmup-error'
      ? [{ t: 'error', code: 'fixture', message: 'synthetic session failure' }]
      : []),
  ].map((event) => serverEventSchema.parse(event));
}
