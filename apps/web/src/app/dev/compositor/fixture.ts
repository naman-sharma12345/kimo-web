import type { Asset, Clip, KimoProject, Track } from '@kimo/client';
export const goldenCases = [
  { id: 'cut', frame: 60 },
  { id: 'speed-split', frame: 90 },
  { id: 'transform-crop', frame: 45 },
  { id: 'hold-bezier', frame: 45 },
  { id: 'crossfade-dip', frame: 60 },
  { id: 'slide-zoom-whip', frame: 60 },
  { id: 'grade-lut', frame: 45 },
  { id: 'effects', frame: 45 },
  { id: 'mask-scope', frame: 45 },
  { id: 'caption-words', frame: 45 },
  { id: 'lower-third-shape', frame: 45 },
  { id: 'portrait-overlay', frame: 45 },
] as const;
export type GoldenCase = (typeof goldenCases)[number]['id'];
const transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
export function fixtureProject(
  testCase: GoldenCase = 'cut',
  overload = false,
  base = 'http://localhost:8787',
): { project: KimoProject; assets: Asset[] } {
  const tracks: Track[] = Array.from({ length: 5 }, (_, i) => ({
    id: `track-${i}`,
    name: `fixture track ${i + 1}`,
    kind: i === 4 ? 'audio' : i === 3 ? 'text' : 'video',
    height: 64,
    locked: false,
    hidden: false,
    muted: false,
  }));
  const assets: Asset[] = [1, 2, 3].map((i) => ({
    id: `video-${i}`,
    name: `synthetic clip ${i}`,
    kind: 'video',
    url: `${base}/fixtures/clip-${i}.mp4`,
    width: 1920,
    height: 1080,
    durationSec: 8,
    source: 'user',
  }));
  assets.push(
    {
      id: 'audio',
      name: 'synthetic music',
      kind: 'audio',
      url: `${base}/fixtures/music.wav`,
      durationSec: 8,
      source: 'user',
    },
    {
      id: 'mask',
      name: 'synthetic mask, not SAM inference',
      kind: 'image',
      url: `${base}/fixtures/mask.png`,
      width: 640,
      height: 360,
      source: 'user',
      mask: {
        encoding: 'luma_image',
        width: 640,
        height: 360,
        channel: 'luma',
        coordinateSpace: 'source_uv',
      },
    },
    {
      id: 'lut',
      name: 'identity atlas',
      kind: 'image',
      url: `${base}/fixtures/identity-lut.png`,
      width: 512,
      height: 512,
      source: 'user',
      lut: { size: 64, layout: 'tiles_8x8', colorSpace: 'srgb' },
    },
  );
  const clips: Record<string, Clip> = {};
  for (let track = 0; track < 5; track++)
    for (let n = 0; n < 4; n++) {
      const id = `clip-${track}-${n}`;
      clips[id] = {
        id,
        trackId: `track-${track}`,
        kind: track === 4 ? 'audio' : track === 3 ? 'text' : 'video',
        start: n * 3,
        duration: 3,
        in: 0,
        speed: 1,
        transform: {
          ...transform,
          scale: track === 1 ? 0.65 : track === 2 ? 0.4 : 1,
          x: track === 1 ? -300 : track === 2 ? 400 : 0,
        },
        effects: [],
        keyframes: [],
        ...(track < 3
          ? { assetId: `video-${track + 1}` }
          : track === 4
            ? { assetId: 'audio', audioRole: 'music', volume: 0.3 }
            : { text: { content: 'live fixture', style: 'caption-clean' } }),
      };
    }
  const clipAt = (id: string): Clip => {
    const value = clips[id];
    if (!value) throw new Error(`Missing fixture clip ${id}`);
    return value;
  };
  const first = clipAt('clip-0-0'),
    second = clipAt('clip-0-1'),
    text = clipAt('clip-3-0');
  // The first cut is fixed at 2s so frame 60 exercises the exact boundary.
  first.duration = 2;
  second.start = 2;
  second.duration = 4;
  switch (testCase) {
    case 'speed-split':
      first.speed = 1.5;
      second.in = 3;
      second.speed = 1.5;
      second.animationOffsetSec = 2;
      second.duration = 2;
      clipAt('clip-0-2').start = 4;
      clipAt('clip-0-2').duration = 5;
      break;
    case 'portrait-overlay':
      first.transform.scale = 1920 / 1080 / (1080 / 1920);
      first.keyframes = [
        { property: 'transform.x', time: 0, value: -100 },
        { property: 'transform.x', time: 2, value: 100, easing: 'ease_in_out' },
      ];
      break;
    case 'transform-crop':
      first.transform = {
        x: 120,
        y: -70,
        scale: 0.8,
        rotation: 12,
        opacity: 0.8,
        crop: { l: 0.1, t: 0.1, r: 0.1, b: 0.1 },
      };
      break;
    case 'hold-bezier':
      first.keyframes = [
        { property: 'transform.x', time: 0, value: -200, easing: 'hold' },
        {
          property: 'transform.x',
          time: 1,
          value: 0,
          easing: 'bezier',
          bezier: [0.22, 1, 0.36, 1],
        },
        { property: 'transform.x', time: 2, value: 200 },
      ];
      break;
    case 'crossfade-dip':
      second.transitionIn = {
        kind: 'crossfade',
        duration: 0.6,
        durationFrames: 18,
      };
      clipAt('clip-0-2').transitionIn = {
        kind: 'dip',
        duration: 0.6,
        durationFrames: 18,
      };
      break;
    case 'slide-zoom-whip':
      second.transitionIn = {
        kind: 'slide',
        direction: 'left',
        duration: 0.6,
        durationFrames: 18,
      };
      clipAt('clip-1-1').start = 2;
      clipAt('clip-1-0').duration = 2;
      clipAt('clip-1-1').transitionIn = {
        kind: 'zoom_in',
        duration: 0.6,
        durationFrames: 18,
      };
      clipAt('clip-2-1').start = 2;
      clipAt('clip-2-0').duration = 2;
      clipAt('clip-2-1').transitionIn = {
        kind: 'whip',
        direction: 'right',
        duration: 0.6,
        durationFrames: 18,
      };
      break;
    case 'grade-lut':
      first.effects = [
        {
          id: 'grade',
          kind: 'colour_grade',
          params: { exposure: 0.2, contrast: 1.1, saturation: 1.15 },
        },
        { id: 'lut', kind: 'lut', params: { lutAssetId: 'lut' } },
      ];
      break;
    case 'effects':
      first.effects = [
        { id: 'blur', kind: 'blur', params: { radius: 2 } },
        { id: 'grain', kind: 'grain', params: { amount: 0.02 } },
        { id: 'sharp', kind: 'sharpen', params: { amount: 0.2 } },
        { id: 'vignette', kind: 'vignette', params: { strength: 0.3 } },
        { id: 'bw', kind: 'black_white', params: {} },
      ];
      break;
    case 'mask-scope':
      first.mask = {
        kind: 'sam',
        maskAssetId: 'mask',
        invert: true,
        feather: 0,
        mode: 'selection',
      };
      first.effects = [
        {
          id: 'scoped',
          kind: 'blur',
          scope: 'outside_mask',
          params: { radius: 3 },
        },
      ];
      break;
    case 'caption-words':
      text.text = {
        content: 'one live frame',
        style: 'caption-pop',
        words: [
          { w: 'one', t: 0, d: 1 },
          { w: 'live', t: 1, d: 1 },
          { w: 'frame', t: 2, d: 1 },
        ],
      };
      break;
    case 'lower-third-shape':
      text.text = {
        content: 'synthetic title',
        secondaryContent: 'synthetic subtitle',
        style: 'lower-third',
      };
      clips['clip-2-0'] = {
        ...clipAt('clip-2-0'),
        kind: 'shape',
        assetId: undefined,
        shape: {
          kind: 'rect',
          width: 400,
          height: 100,
          radius: 8,
          fill: [0.1, 0.1, 0.1, 1],
        },
      };
      break;
  }
  if (overload)
    Object.values(clips)
      .filter((clip) => clip.kind === 'video')
      .forEach((clip, index) => {
        clip.start = index < 7 ? 0 : 6 + (index - 7) * 3;
        clip.duration = index < 7 ? 6 : 3;
      });
  return {
    project: {
      id: `compositor-${testCase}${overload ? '-overload' : ''}`,
      version: 1,
      fps: 30,
      width: testCase === 'portrait-overlay' ? 1080 : 1920,
      height: testCase === 'portrait-overlay' ? 1920 : 1080,
      duration: overload ? 21 : 12,
      tracks,
      clips,
      markers: [],
    },
    assets,
  };
}
export function maximumSimultaneousVideos(project: KimoProject): number {
  const events = Object.values(project.clips)
    .filter((clip) => clip.kind === 'video')
    .flatMap((clip) => [
      { time: clip.start, delta: 1 },
      { time: clip.start + clip.duration, delta: -1 },
    ])
    .sort((a, b) => a.time - b.time || a.delta - b.delta);
  let active = 0,
    max = 0;
  for (const event of events) {
    active += event.delta;
    max = Math.max(max, active);
  }
  return max;
}
