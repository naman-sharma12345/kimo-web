import { expect, it, vi } from 'vitest';
import { drawTrack, readPalette } from './draw-track';
import { clip, track } from './test-fixtures';
function canvas() {
  const calls: { color: string; x: number; y: number }[] = [];
  const context = {
    strokeStyle: '',
    lineWidth: 1,
    fillStyle: '',
    globalAlpha: 1,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo(x: number, y: number) {
      calls.push({ color: this.strokeStyle, x, y });
    },
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
  };
  return { ctx: context as unknown as CanvasRenderingContext2D, calls };
}
it('paints cream16 detected ticks once per track/time only inside bounded viewport music clips', () => {
  const node = document.createElement('div');
  node.style.setProperty('--cream-16', 'beat-color');
  document.body.append(node);
  const palette = readPalette(node);
  node.remove();
  const music = clip('m', {
    trackId: 'aud',
    kind: 'audio',
    audioRole: 'music',
    start: 0,
    duration: 100,
  });
  const { ctx, calls } = canvas();
  drawTrack(ctx, {
    clips: [music, { ...music, id: 'overlap' }],
    track: track('aud', 'audio'),
    assets: [],
    width: 300,
    height: 64,
    origin: 100,
    zoom: 100,
    palette,
    selection: [],
    beats: [
      { clipId: 'm', trackId: 'aud', time: 2 },
      { clipId: 'overlap', trackId: 'aud', time: 2 },
      { clipId: 'm', trackId: 'aud', time: 50 },
      { clipId: 'missing', trackId: 'aud', time: 2.5 },
      { clipId: 'm', trackId: 'wrong', time: 3 },
    ],
  });
  expect(calls.filter((call) => call.color === 'beat-color')).toEqual([
    { color: 'beat-color', x: 100, y: 22 },
  ]);
});
it('draws no beat ticks without detections or on voice clips', () => {
  const node = document.createElement('div');
  node.style.setProperty('--cream-16', 'beat-color');
  document.body.append(node);
  const palette = readPalette(node);
  node.remove();
  for (const beats of [undefined, [{ clipId: 'm', trackId: 'aud', time: 2 }]]) {
    const { ctx, calls } = canvas();
    drawTrack(ctx, {
      clips: [
        clip('m', {
          trackId: 'aud',
          kind: 'audio',
          audioRole: 'voice',
          start: 0,
          duration: 4,
        }),
      ],
      track: track('aud', 'audio'),
      assets: [],
      width: 300,
      height: 64,
      origin: 0,
      zoom: 100,
      palette,
      selection: [],
      beats,
    });
    expect(calls.filter((call) => call.color === 'beat-color')).toEqual([]);
  }
});
