import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FilmstripService,
  FilmstripWorkerEncoder,
  audioPeaks,
  filmstripTimes,
  legacyTimestampedFrames,
  type FilmstripCache,
  type FilmstripClip,
} from './filmstrip';
import { resizeFilmstripBitmap } from './filmstrip.worker';
import { MediaPool, type ExtractionLease } from './media-pool';

const clip: FilmstripClip = {
  id: 'c',
  trackId: 't',
  kind: 'video',
  start: 9,
  duration: 4,
  in: 2,
  speed: 2,
  assetId: 'a',
  asset: { id: 'a', url: '/original', proxyUrl: '/proxy', durationSec: 20 },
};
class ExtractionPool extends MediaPool {
  readonly video = document.createElement('video');
  times: number[] = [];
  release = vi.fn();
  exhausted = false;
  override acquireExtraction(): ExtractionLease | null {
    if (this.exhausted) return null;
    return {
      element: this.video,
      isCurrent: () => true,
      seek: async (time) => {
        this.times.push(time);
        return { element: this.video, sourceTime: time, exact: true };
      },
      release: this.release,
    };
  }
}
function setup(cache?: FilmstripCache) {
  const pool = new ExtractionPool();
  const issues: string[] = [];
  const closes: ReturnType<typeof vi.fn>[] = [];
  const capture = vi.fn(async () => {
    const close = vi.fn();
    closes.push(close);
    return { close } as unknown as ImageBitmap;
  });
  const encode = vi.fn(async (bitmap: ImageBitmap) => {
    bitmap.close();
    return new Blob(['jpeg'], { type: 'image/jpeg' });
  });
  const service = new FilmstripService({
    pool,
    cache,
    capture,
    encode,
    onIssue: (issue) => issues.push(issue),
  });
  return { pool, service, capture, encode, closes, issues };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('Filmstrip source-time extraction/cache boundary', () => {
  it('maps trim and speed into timestamped source samples, independent of timeline start', () => {
    expect(filmstripTimes(clip, 2)).toEqual([4, 8]);
    const legacy = legacyTimestampedFrames([new Blob(), new Blob()], 20);
    expect(legacy.map((entry) => entry.time)).toEqual([5, 15]);
    expect(legacy.every((entry) => entry.exact === false)).toBe(true);
    expect(legacyTimestampedFrames([new Blob()], NaN)).toEqual([]);
  });
  it('uses injected timestamped cached frames without opening a decoder or upgrading degraded evidence', async () => {
    const cache = {
      read: vi.fn(async () => ({
        frames: [
          {
            time: 4,
            blob: new Blob(),
            exact: false,
            reason: 'legacy midpoint',
          },
          { time: 8, blob: new Blob(), exact: true },
        ],
      })),
      write: vi.fn(async () => {}),
    };
    const { pool, service, capture } = setup(cache);
    const frames = await service.getFilmstrip(clip, 160);
    expect(frames.map((entry) => entry.time)).toEqual([4, 8]);
    expect(frames[0]?.exact).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    expect(pool.times).toEqual([]);
    expect(cache.read.mock.calls[0]).toBeDefined();
    service.dispose();
  });
  it('extracts through decoder leases then injected encoding; reuses real results in memory', async () => {
    const cache = {
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => {}),
    };
    const { pool, service, encode, closes } = setup(cache);
    const frames = await service.getFilmstrip(clip, 160);
    expect(pool.times).toEqual([4, 8]);
    expect(encode).toHaveBeenCalledTimes(2);
    expect(closes.every((close) => close.mock.calls.length === 1)).toBe(true);
    expect(frames.every((frame) => frame.exact)).toBe(true);
    expect(pool.release).toHaveBeenCalledOnce();
    expect(cache.write).toHaveBeenCalledOnce();
    expect(cache.write.mock.calls.length).toBe(1);
    await service.getFilmstrip(clip, 160);
    expect(pool.times).toHaveLength(2);
    service.dispose();
  });
  it('invalidates by proxy identity and caps per-call extraction count', async () => {
    const { pool, service } = setup();
    await service.getFilmstrip(clip, 160);
    await service.getFilmstrip(
      { ...clip, asset: { ...clip.asset, proxyUrl: '/new-proxy' } },
      160,
    );
    expect(pool.times).toHaveLength(4);
    await service.getFilmstrip(
      { ...clip, asset: { ...clip.asset, id: 'other' } },
      100000,
    );
    expect(pool.times).toHaveLength(68);
    service.dispose();
  });
  it('surfaces cache quota/read failures and does not fabricate persisted hits', async () => {
    const cache = {
      read: vi.fn(async () => {
        throw new Error('IndexedDB denied');
      }),
      write: vi.fn(async () => {
        throw new DOMException('Full', 'QuotaExceededError');
      }),
    };
    const { pool, service, issues } = setup(cache);
    const frames = await service.getFilmstrip(clip, 160);
    expect(frames).toHaveLength(2);
    expect(pool.times).toEqual([4, 8]);
    expect(issues.join()).toContain('read failed');
    expect(issues.join()).toContain('write failed');
    service.dispose();
    const second = setup(cache);
    await second.service.getFilmstrip(clip, 160);
    expect(second.pool.times).toHaveLength(2);
    second.service.dispose();
  });
  it('defers extraction when preview owns all decoders and releases on taint errors', async () => {
    const { pool, service, capture } = setup();
    pool.exhausted = true;
    await expect(service.getFilmstrip(clip, 160)).rejects.toThrow(
      'decoder budget',
    );
    expect(capture).not.toHaveBeenCalled();
    pool.exhausted = false;
    capture.mockRejectedValueOnce(
      new DOMException('Cross-origin pixels', 'SecurityError'),
    );
    await expect(service.getFilmstrip(clip, 160)).rejects.toMatchObject({
      name: 'SecurityError',
    });
    expect(pool.release).toHaveBeenCalledOnce();
    service.dispose();
  });
  it('cancels between seeks and encoding, releases lease, never writes incomplete frames', async () => {
    const controller = new AbortController();
    const cache = {
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => {}),
    };
    const { service, pool, capture } = setup(cache);
    capture.mockImplementationOnce(async () => {
      controller.abort();
      return { close: vi.fn() } as unknown as ImageBitmap;
    });
    await expect(
      service.getFilmstrip(clip, 160, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(pool.release).toHaveBeenCalledOnce();
    expect(cache.write).not.toHaveBeenCalled();
    service.dispose();
    await expect(service.getFilmstrip(clip, 160)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('remaps cached 10ms source waveform peaks through trim/speed', async () => {
    const peaks = new Float32Array(1000);
    peaks[200] = 0.4;
    peaks[400] = 0.9;
    peaks[600] = 0.5;
    peaks[800] = 0.7;
    const cache = {
      read: vi.fn(async () => ({
        timelinePeaks: peaks,
        waveform: new Float32Array(64),
      })),
      write: vi.fn(async () => {}),
    };
    const { service } = setup(cache);
    const output = await service.getWaveform(clip, 4);
    expect(Array.from(output)).toEqual([
      expect.closeTo(0.4),
      expect.closeTo(0.9),
      expect.closeTo(0.5),
      expect.closeTo(0.7),
    ]);
    service.dispose();
  });
  it('computes channel-maximum peaks from actually supplied samples and caches them', async () => {
    const samples = [
      new Float32Array([0, 0.5, 0, -0.25]),
      new Float32Array([0, 0, -0.75, 0]),
    ];
    const buffer = {
      duration: 0.04,
      sampleRate: 100,
      numberOfChannels: 2,
      getChannelData: (index: number) => samples[index],
    } as AudioBuffer;
    expect(Array.from(audioPeaks(buffer).timelinePeaks ?? [])).toEqual([
      0, 0.5, 0.75, 0.25,
    ]);
    const decodeAudio = vi.fn(async () => buffer);
    const service = new FilmstripService({
      pool: new ExtractionPool(),
      decodeAudio,
    });
    const c = { ...clip, kind: 'audio', in: 0, duration: 0.04, speed: 1 };
    expect(Array.from(await service.getWaveform(c, 4))).toEqual([
      0, 0.5, 0.75, 0.25,
    ]);
    await service.getWaveform(c, 4);
    expect(decodeAudio).toHaveBeenCalledOnce();
    service.dispose();
  });
  it('reuses nearest actual legacy thumbnails with their real source timestamps, not fake exact times', async () => {
    const cache = {
      read: vi.fn(async () => ({
        frames: legacyTimestampedFrames(
          Array.from({ length: 8 }, () => new Blob()),
          20,
        ),
      })),
      write: vi.fn(async () => {}),
    };
    const { pool, service } = setup(cache);
    const frames = await service.getFilmstrip(clip, 160);
    expect(frames.map((entry) => entry.time)).toEqual([3.75, 8.75]);
    expect(frames.every((entry) => entry.exact === false)).toBe(true);
    expect(pool.times).toHaveLength(0);
    service.dispose();
  });
  it('falls back from tainted extraction only to real cached samples with explicit degradation', async () => {
    const cache = {
      read: vi.fn(async () => ({
        frames: [{ time: 4, blob: new Blob(['real cache']) }],
      })),
      write: vi.fn(async () => {}),
    };
    const { pool, service, capture, issues } = setup(cache);
    capture.mockRejectedValueOnce(new DOMException('Tainted', 'SecurityError'));
    const frames = await service.getFilmstrip(
      { ...clip, asset: { ...clip.asset, durationSec: undefined } },
      160,
    );
    expect(frames.map((frame) => frame.time)).toEqual([4, 4]);
    expect(
      frames.every(
        (frame) => !frame.exact && frame.reason?.includes('tainted'),
      ),
    ).toBe(true);
    expect(issues.join()).toContain('tainted');
    expect(cache.write).not.toHaveBeenCalled();
    expect(pool.release).toHaveBeenCalledOnce();
    service.dispose();
  });
  it('does not publish or leak a bitmap captured after preview preempts its decoder lease', async () => {
    const pool = new ExtractionPool();
    const valid = { value: true };
    const close = vi.fn();
    const release = vi.fn();
    vi.spyOn(pool, 'acquireExtraction').mockReturnValue({
      element: pool.video,
      isCurrent: () => valid.value,
      seek: async (time) => ({
        element: pool.video,
        sourceTime: time,
        exact: true,
      }),
      release,
    });
    const encode = vi.fn(async () => new Blob());
    const service = new FilmstripService({
      pool,
      capture: async () => {
        valid.value = false;
        return { close } as unknown as ImageBitmap;
      },
      encode,
    });
    await expect(service.getFilmstrip(clip, 80)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(close).toHaveBeenCalledOnce();
    expect(encode).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    service.dispose();
  });
});
class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  terminate = vi.fn();
  get worker() {
    return this as unknown as Worker;
  }
}
describe('Filmstrip worker decoder boundary and resource ownership', () => {
  it('transfers bitmaps and correlates the encoded Blob, without sending MP4 URLs', async () => {
    const worker = new FakeWorker();
    const encoder = new FilmstripWorkerEncoder(() => worker.worker);
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const pending = encoder.encode(bitmap, 80, 45);
    expect(worker.postMessage).toHaveBeenCalledWith(
      { id: 1, bitmap, width: 80, height: 45 },
      [bitmap],
    );
    const blob = new Blob(['jpeg']);
    worker.dispatchEvent(
      new MessageEvent('message', { data: { id: 1, blob } }),
    );
    expect(await pending).toBe(blob);
    encoder.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('rejects worker error/timeout/abort/dispose rather than inventing cached images', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const encoder = new FilmstripWorkerEncoder(() => worker.worker);
    const make = () => ({ close: vi.fn() }) as unknown as ImageBitmap;
    const first = encoder.encode(make(), 80, 45);
    const error = expect(first).rejects.toThrow('tainted');
    worker.dispatchEvent(
      new MessageEvent('message', { data: { id: 1, error: 'tainted' } }),
    );
    await error;
    const timeout = encoder.encode(make(), 80, 45);
    const timed = expect(timeout).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(10001);
    await timed;
    const controller = new AbortController();
    const pending = encoder.encode(make(), 80, 45, controller.signal);
    const cancelled = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await cancelled;
    const disposed = encoder.encode(make(), 80, 45);
    const ended = expect(disposed).rejects.toMatchObject({
      name: 'AbortError',
    });
    encoder.dispose();
    await ended;
  });
  it('closes incoming bitmaps when worker creation fails and when encoding throws', async () => {
    const close = vi.fn();
    const encoder = new FilmstripWorkerEncoder(() => {
      throw new Error('CSP');
    });
    await expect(
      encoder.encode({ close } as unknown as ImageBitmap, 80, 45),
    ).rejects.toThrow('CSP');
    expect(close).toHaveBeenCalledOnce();
    vi.stubGlobal('OffscreenCanvas', undefined);
    const close2 = vi.fn();
    await expect(
      resizeFilmstripBitmap(
        { close: close2 } as unknown as ImageBitmap,
        80,
        45,
      ),
    ).rejects.toThrow('unavailable');
    expect(close2).toHaveBeenCalledOnce();
    encoder.dispose();
  });
  it('uses OffscreenCanvas resize/encode in worker-compatible function and always closes transfers', async () => {
    const drawImage = vi.fn();
    const blob = new Blob(['encoded']);
    const convertToBlob = vi.fn(async () => blob);
    class Canvas {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { drawImage };
      }
      convertToBlob = convertToBlob;
    }
    vi.stubGlobal('OffscreenCanvas', Canvas);
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    expect(await resizeFilmstripBitmap(bitmap, 80, 45)).toBe(blob);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 80, 45);
    expect(convertToBlob).toHaveBeenCalledWith({
      type: 'image/jpeg',
      quality: 0.8,
    });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
