import type { Asset, Clip, KimoProject } from '@kimo/client';
export const video: Clip = {
  id: 'c',
  trackId: 'v',
  kind: 'video',
  assetId: 'a',
  start: 0,
  duration: 4,
  in: 1,
  speed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  effects: [],
  keyframes: [],
};
export const title: Clip = {
  ...video,
  id: 't',
  trackId: 'txt',
  kind: 'text',
  assetId: undefined,
  text: {
    content: 'hello world',
    style: 'caption-clean',
    words: [
      { w: 'hello', t: 0, d: 1 },
      { w: 'world', t: 1, d: 3 },
    ],
  },
};
export const assets: Asset[] = [
  {
    id: 'a',
    kind: 'video',
    name: 'beach',
    url: '/video.mp4',
    source: 'user',
    durationSec: 20,
  },
];
export const fixture = (): KimoProject & {
  clips: Record<string, Clip> & { c: Clip; t: Clip };
} =>
  structuredClone({
    id: 'p',
    version: 0,
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 4,
    tracks: [
      {
        id: 'v',
        name: 'V1',
        kind: 'video',
        height: 88,
        muted: false,
        hidden: false,
        locked: false,
      },
      {
        id: 'txt',
        name: 'text',
        kind: 'text',
        height: 48,
        muted: false,
        hidden: false,
        locked: false,
      },
      {
        id: 'aud',
        name: 'audio',
        kind: 'audio',
        height: 64,
        muted: false,
        hidden: false,
        locked: false,
      },
    ],
    clips: { c: video, t: title },
    markers: [],
  });
export function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
