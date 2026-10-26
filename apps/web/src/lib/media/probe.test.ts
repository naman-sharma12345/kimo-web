import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareTimeline, probeMedia, releaseMetadata } from './probe';
const revoke = vi.fn();
const draw = vi.fn();
let sequence = 0;
class Canvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return { drawImage: draw };
  }
  convertToBlob() {
    return Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }));
  }
}
beforeEach(() => {
  sequence = 0;
  draw.mockClear();
  revoke.mockClear();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => `blob:test-${++sequence}`),
    revokeObjectURL: revoke,
  });
  vi.stubGlobal('OffscreenCanvas', Canvas);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fakeVideo(width = 1920, height = 1080) {
  const video = document.createElement('video');
  const times: number[] = [];
  Object.defineProperties(video, {
    videoWidth: { value: width },
    videoHeight: { value: height },
    duration: { value: 12 },
    readyState: { value: 2 },
    src: {
      set: () => {
        void Promise.resolve().then(() =>
          video.dispatchEvent(new Event('loadedmetadata')),
        );
      },
    },
    currentTime: {
      get: () => times.at(-1) ?? 0,
      set: (time: number) => {
        times.push(time);
        void Promise.resolve().then(() =>
          video.dispatchEvent(new Event('seeked')),
        );
      },
    },
  });
  video.pause = vi.fn();
  video.load = vi.fn();
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
    tag === 'video' ? video : create(tag),
  );
  return { video, times };
}
describe('browser media probing', () => {
  it('reads video metadata, seeks for a JPEG thumbnail, and releases source URLs', async () => {
    const { times, video } = fakeVideo();
    const meta = await probeMedia(
      new File(['v'], 'clip.mp4', { type: 'video/mp4' }),
      'clip',
      new AbortController().signal,
    );
    expect(meta).toMatchObject({
      durationSec: 12,
      width: 1920,
      height: 1080,
      thumbBlobUrl: 'blob:test-2',
    });
    expect(times).toEqual([1]);
    expect(draw).toHaveBeenCalledWith(video, 0, 0, 160, 90);
    expect(revoke).toHaveBeenCalledWith('blob:test-1');
    releaseMetadata(meta);
    expect(revoke).toHaveBeenCalledWith('blob:test-2');
  });
  it('makes portrait video thumbnails 90 by 160', async () => {
    const { video } = fakeVideo(1080, 1920);
    await probeMedia(
      new File(['v'], 'clip.mp4', { type: 'video/mp4' }),
      'portrait',
      new AbortController().signal,
    );
    expect(draw).toHaveBeenCalledWith(video, 0, 0, 90, 160);
  });
  it('extracts eight evenly spaced 80px high lazy filmstrip frames', async () => {
    const { times, video } = fakeVideo();
    const meta = await prepareTimeline(
      new File(['v'], 'clip.mp4', { type: 'video/mp4' }),
      'timeline',
      { durationSec: 12 },
      new AbortController().signal,
    );
    expect(meta.filmstripBlobUrls).toHaveLength(8);
    expect(times).toEqual([0.75, 2.25, 3.75, 5.25, 6.75, 8.25, 9.75, 11.25]);
    expect(draw).toHaveBeenCalledWith(video, 0, 0, 142, 80);
    releaseMetadata(meta);
    expect(revoke).toHaveBeenCalledTimes(9);
  });
  it('uses createImageBitmap, scales the longest edge to 160, and closes the bitmap', async () => {
    const bitmap = { width: 600, height: 1200, close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const meta = await probeMedia(
      new File(['i'], 'photo.jpg', { type: 'image/jpeg' }),
      'image',
      new AbortController().signal,
    );
    expect(meta).toMatchObject({ width: 600, height: 1200 });
    expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, 80, 160);
    expect(bitmap.close).toHaveBeenCalled();
  });
  it('falls back on unsupported codecs without stopping uploads', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('Unsupported codec');
      }),
    );
    const meta = await probeMedia(
      new File(['i'], 'photo.heic', { type: 'image/heic' }),
      'image',
      new AbortController().signal,
    );
    expect(meta.previewUnsupported).toBe(true);
  });
  it('decodes audio with 8k mono OfflineAudioContext and computes 64 chip peaks', async () => {
    const constructed: number[][] = [];
    class AudioContext {
      destination = {};
      constructor(channels: number, length: number, rate: number) {
        constructed.push([channels, length, rate]);
      }
      decodeAudioData() {
        return Promise.resolve({ duration: 1 });
      }
      createBufferSource() {
        return { buffer: undefined, connect: vi.fn(), start: vi.fn() };
      }
      startRendering() {
        return Promise.resolve({
          getChannelData: () => Float32Array.from({ length: 8000 }, () => 0.5),
        });
      }
    }
    vi.stubGlobal('OfflineAudioContext', AudioContext);
    const file = new File(['a'], 'audio.wav', { type: 'audio/wav' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new ArrayBuffer(1),
    });
    const meta = await prepareTimeline(
      file,
      'audio',
      { durationSec: 1 },
      new AbortController().signal,
    );
    expect(constructed).toEqual([
      [1, 1, 8000],
      [1, 8000, 8000],
    ]);
    expect(meta.waveform).toEqual(new Float32Array(64).fill(0.5));
  });
});
