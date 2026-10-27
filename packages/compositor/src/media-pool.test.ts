import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaPool } from './media-pool';
import type { MediaAsset, VideoRequest } from './media-types';

/** DOM callback double. No assertion here certifies a real decoded frame. */
class FakeVideo extends EventTarget {
  src = '';
  crossOrigin = '';
  muted = true;
  playsInline = false;
  preservesPitch = true;
  preload = '';
  duration = 100;
  readyState = 2;
  seeking = false;
  paused = true;
  playbackRate = 1;
  videoWidth = 160;
  videoHeight = 90;
  time = 0;
  next = 0;
  order: string[] = [];
  callbacks = new Map<number, VideoFrameRequestCallback>();
  cancelled = new Map<number, VideoFrameRequestCallback>();
  load = vi.fn();
  pause = vi.fn(() => {
    this.paused = true;
  });
  play = vi.fn(async () => {
    this.paused = false;
  });
  get currentTime() {
    return this.time;
  }
  set currentTime(value: number) {
    this.order.push('seek');
    this.time = value;
  }
  fastSeek = vi.fn((value: number) => {
    this.time = value;
  });
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  getAttribute(name: string) {
    return name === 'src' ? this.src : null;
  }
  requestVideoFrameCallback = (callback: VideoFrameRequestCallback) => {
    this.order.push('register');
    this.callbacks.set(++this.next, callback);
    return this.next;
  };
  cancelVideoFrameCallback = (id: number) => {
    const callback = this.callbacks.get(id);
    if (callback) this.cancelled.set(id, callback);
    this.callbacks.delete(id);
  };
  present(time = this.time) {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks)
      callback(0, { mediaTime: time } as VideoFrameCallbackMetadata);
  }
  get element() {
    return this as unknown as HTMLVideoElement;
  }
}
const asset: MediaAsset = {
  id: 'a',
  url: '/original.mp4',
  proxyUrl: '/proxy.mp4',
};
function request(
  id: string,
  start = 0,
  purpose?: 'video' | 'mask',
): VideoRequest {
  return { clipId: id, asset, start, duration: 10, in: 2, speed: 1.5, purpose };
}
function setup(maxDecoders = 6) {
  const videos: FakeVideo[] = [];
  const pool = new MediaPool({
    createVideo: () => {
      const video = new FakeVideo();
      videos.push(video);
      return video.element;
    },
    maxDecoders,
    timeoutMs: 100,
  });
  return { pool, videos };
}
afterEach(() => vi.useRealTimers());
describe('MediaPool physical decoder ownership', () => {
  it('uses one physical element per instance, proxy first, CORS before src', async () => {
    const order: string[] = [];
    const videos: FakeVideo[] = [];
    const pool = new MediaPool({
      createVideo: () => {
        const video = new FakeVideo();
        let src = '';
        let cors = '';
        Object.defineProperty(video, 'src', {
          get: () => src,
          set: (value: string) => {
            order.push(`src:${cors}`);
            src = value;
          },
        });
        Object.defineProperty(video, 'crossOrigin', {
          get: () => cors,
          set: (value: string) => {
            cors = value;
          },
        });
        videos.push(video);
        return video.element;
      },
    });
    const promise = pool.sync([request('left'), request('right')], {
      time: 1,
      playing: false,
    });
    expect(videos).toHaveLength(2);
    expect(videos[0]?.src).toBe('/proxy.mp4');
    expect(order).toEqual(['src:anonymous', 'src:anonymous']);
    for (const video of videos) {
      expect(video.order).toEqual(['register', 'seek']);
      video.present();
    }
    const result = await promise;
    expect(result.frames.size).toBe(2);
    expect(result.frames.get('left')?.sourceTime).toBe(3.5);
    pool.dispose();
  });
  it('counts video, masks, extraction and warmups in one <=6 budget', async () => {
    const { pool, videos } = setup();
    const warm = new FakeVideo();
    warm.src = '/warm.mp4';
    const map = new Map([['a', warm.element]]);
    pool.adoptWarmup(map);
    expect(map.size).toBe(0);
    const lease = pool.acquireExtraction('job', asset);
    expect(lease).not.toBeNull();
    expect(pool.decoderCount).toBe(2);
    const promise = pool.sync(
      Array.from({ length: 8 }, (_, i) =>
        request(String(i), 0, i === 1 ? 'mask' : 'video'),
      ),
      { time: 0, playing: true },
    );
    expect(pool.decoderCount).toBe(6);
    expect(pool.physicalElementCount).toBe(6);
    warm.present();
    for (const video of videos) video.present();
    const result = await promise;
    expect(result.frames.size).toBe(6);
    expect(result.issues.join()).toContain('budget exceeded');
    await expect(lease?.seek(1)).rejects.toMatchObject({ name: 'AbortError' });
    pool.dispose();
  });
  it('prerolls only within 1.5s, prioritizes visible, pauses preroll, reuses elements', async () => {
    const { pool, videos } = setup(2);
    const promise = pool.sync(
      [request('far', 2), request('near', 1.5), request('visible')],
      { time: 0, playing: true, rate: 2 },
    );
    expect(pool.getVideo('far')).toBeUndefined();
    expect(videos).toHaveLength(2);
    for (const video of videos) video.present();
    await promise;
    expect(pool.getVideo('near')?.paused).toBe(true);
    expect(pool.getVideo('visible')?.playbackRate).toBe(3);
    const again = pool.sync([request('next', 3)], { time: 3, playing: false });
    for (const video of videos) video.present();
    await again;
    expect(videos).toHaveLength(2);
    expect(pool.decoderCount).toBe(1);
    pool.dispose();
  });
  it('requires presented timestamp within half a project frame and discards stale callbacks', async () => {
    const { pool, videos } = setup();
    const lease = pool.acquireExtraction('one', asset);
    const video = videos[0];
    if (!lease || !video) throw new Error('setup');
    const old = lease.seek(1);
    const rejection = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const current = lease.seek(2);
    await rejection;
    for (const callback of video.cancelled.values())
      callback(0, { mediaTime: 1 } as VideoFrameCallbackMetadata);
    let resolved = false;
    void current.then(() => {
      resolved = true;
    });
    video.present(2.02);
    await Promise.resolve();
    expect(resolved).toBe(false);
    video.present(2.01);
    expect((await current).exact).toBe(true);
    pool.dispose();
  });
  it('reports seeked-only and timed-out metadata as degraded, not exact', async () => {
    vi.useFakeTimers();
    const { pool, videos } = setup();
    const lease = pool.acquireExtraction('one', asset);
    const video = videos[0];
    if (!lease || !video) throw new Error('setup');
    const promise = lease.seek(2);
    video.dispatchEvent(new Event('seeked'));
    await vi.advanceTimersByTimeAsync(101);
    expect(await promise).toMatchObject({
      exact: false,
      reason: expect.stringContaining('timestamp timeout'),
    });
    Object.defineProperty(video, 'requestVideoFrameCallback', {
      value: undefined,
    });
    const next = lease.seek(3);
    video.dispatchEvent(new Event('seeked'));
    expect(await next).toMatchObject({
      exact: false,
      reason: expect.stringContaining('seeked-only'),
    });
    pool.dispose();
  });
  it('uses fastSeek for drag and exact callback evidence on release', async () => {
    const { pool, videos } = setup();
    const lease = pool.acquireExtraction('one', asset);
    const video = videos[0];
    if (!lease || !video) throw new Error('setup');
    const drag = lease.seek(4, { fast: true });
    video.dispatchEvent(new Event('seeked'));
    expect((await drag).exact).toBe(false);
    expect(video.fastSeek).toHaveBeenCalledWith(4);
    const release = lease.seek(4);
    expect(video.order.slice(-2)).toEqual(['register', 'seek']);
    video.present(4);
    expect((await release).exact).toBe(true);
    pool.dispose();
  });
  it('cancels pending work on abort/dispose and cannot release a reused extraction lease', async () => {
    const { pool, videos } = setup(1);
    const first = pool.acquireExtraction('one', asset);
    const video = videos[0];
    if (!first || !video) throw new Error('setup');
    const controller = new AbortController();
    const pending = first.seek(3, { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await rejected;
    first.release();
    const second = pool.acquireExtraction('one', asset);
    first.release();
    expect(pool.decoderCount).toBe(1);
    const last = second?.seek(4);
    const disposed = expect(last).rejects.toMatchObject({ name: 'AbortError' });
    pool.dispose();
    await disposed;
    expect(video.src).toBe('');
    expect(pool.decoderCount).toBe(0);
    expect(video.callbacks.size).toBe(0);
    expect(() => pool.loadImage(asset)).toThrow('disposed');
  });
  it('does not set a negative playbackRate for stepped reverse', async () => {
    const { pool, videos } = setup();
    const promise = pool.sync([request('reverse')], {
      time: 3,
      playing: true,
      rate: -1,
    });
    videos[0]?.present();
    const result = await promise;
    expect(result.issues.join()).toContain('silent stepped');
    expect(videos[0]?.paused).toBe(true);
    expect(videos[0]?.muted).toBe(true);
    expect(videos[0]?.playbackRate).toBe(1);
    pool.dispose();
  });
  it('does not reseek continuously playing elements within drift tolerance', async () => {
    const { pool, videos } = setup();
    const first = pool.sync([request('playing')], { time: 0, playing: true });
    const video = videos[0];
    if (!video) throw new Error('setup');
    video.present();
    await first;
    const seeks = video.order.filter((step) => step === 'seek').length;
    video.time += 0.05;
    video.present();
    await pool.sync([request('playing')], { time: 0.03, playing: true });
    expect(video.order.filter((step) => step === 'seek')).toHaveLength(seeks);
    pool.dispose();
  });
  it('falls back from proxy to original with CORS and reports the fallback', async () => {
    const { pool, videos } = setup();
    const promise = pool.sync([request('clip')], { time: 0, playing: false });
    const video = videos[0];
    if (!video) throw new Error('setup');
    video.dispatchEvent(new Event('error'));
    await Promise.resolve();
    expect(video.src).toBe('/original.mp4');
    video.present();
    const result = await promise;
    expect(result.issues.join()).toContain('using original');
    pool.dispose();
  });
  it('deduplicates image bitmap loads and closes evicted/disposed images', async () => {
    const bitmaps: { close: ReturnType<typeof vi.fn> }[] = [];
    const createImageBitmap = vi.fn(async () => {
      const bitmap = { close: vi.fn() };
      bitmaps.push(bitmap);
      return bitmap as unknown as ImageBitmap;
    });
    const pool = new MediaPool({
      maxImages: 1,
      fetch: vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(),
      })) as unknown as typeof fetch,
      createImageBitmap,
    });
    const one = pool.loadImage(asset);
    expect(pool.loadImage(asset)).toBe(one);
    await one;
    await pool.loadImage({ ...asset, id: 'b' });
    expect(bitmaps[0]?.close).toHaveBeenCalledOnce();
    pool.dispose();
    expect(bitmaps[1]?.close).toHaveBeenCalledOnce();
  });
  it('closes bitmap that finishes after disposal and retries failed loads honestly', async () => {
    let complete: ((bitmap: ImageBitmap) => void) | undefined;
    const close = vi.fn();
    const pool = new MediaPool({
      fetch: vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(),
      })) as unknown as typeof fetch,
      createImageBitmap: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    const pending = pool.loadImage(asset);
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    pool.dispose();
    complete?.({ close } as unknown as ImageBitmap);
    await rejected;
    expect(close).toHaveBeenCalledOnce();
  });
  it('keeps original fallback on subsequent syncs instead of reloading a broken proxy', async () => {
    const { pool, videos } = setup();
    const first = pool.sync([request('clip')], { time: 0, playing: false });
    const video = videos[0];
    if (!video) throw new Error('setup');
    video.dispatchEvent(new Event('error'));
    await Promise.resolve();
    video.present();
    await first;
    const loads = video.load.mock.calls.length;
    const result = await pool.sync([request('clip')], {
      time: 0,
      playing: false,
    });
    expect(result.frames.get('clip')?.exact).toBe(true);
    expect(video.src).toBe('/original.mp4');
    expect(video.load).toHaveBeenCalledTimes(loads);
    pool.dispose();
  });
  it('invalidates extraction ownership immediately when visible preview preempts it', async () => {
    const { pool, videos } = setup(1);
    const lease = pool.acquireExtraction('job', asset);
    if (!lease) throw new Error('setup');
    const seek = lease.seek(2);
    videos[0]?.present();
    await seek;
    expect(lease.isCurrent()).toBe(true);
    const preview = pool.sync([request('clip')], { time: 0, playing: false });
    expect(lease.isCurrent()).toBe(false);
    videos[0]?.present();
    await preview;
    lease.release();
    expect(pool.decoderCount).toBe(1);
    pool.dispose();
  });
  it('pins shared image leases, refuses capacity overrun, and releases idempotently for eviction', async () => {
    const close = vi.fn();
    const pool = new MediaPool({
      maxImages: 1,
      fetch: vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(),
      })) as unknown as typeof fetch,
      createImageBitmap: async () => ({ close }) as unknown as ImageBitmap,
    });
    const a = await pool.acquireImage(asset);
    const b = await pool.acquireImage(asset);
    expect(a.bitmap).toBe(b.bitmap);
    await expect(pool.loadImage({ ...asset, id: 'b' })).rejects.toThrow(
      'capacity pinned',
    );
    a.release();
    a.release();
    expect(close).not.toHaveBeenCalled();
    await expect(pool.loadImage({ ...asset, id: 'b' })).rejects.toThrow(
      'capacity pinned',
    );
    b.release();
    await pool.loadImage({ ...asset, id: 'b' });
    expect(close).toHaveBeenCalledOnce();
    pool.dispose();
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('uses original fallback during extraction as well as preview', async () => {
    const { pool, videos } = setup();
    const lease = pool.acquireExtraction('film', asset);
    if (!lease) throw new Error('setup');
    const pending = lease.seek(3);
    videos[0]?.dispatchEvent(new Event('error'));
    await Promise.resolve();
    expect(videos[0]?.src).toBe('/original.mp4');
    videos[0]?.present(3);
    expect(await pending).toMatchObject({
      exact: true,
      reason: expect.stringContaining('original source'),
    });
    pool.dispose();
  });
  it('supports fast scrubbing in sync without paying for an exact seek first', async () => {
    const { pool, videos } = setup();
    const pending = pool.sync([request('scrub')], {
      time: 2,
      playing: false,
      fast: true,
    });
    const video = videos[0];
    if (!video) throw new Error('setup');
    expect(video.fastSeek).toHaveBeenCalledWith(5);
    expect(video.order).toEqual(['register']);
    video.dispatchEvent(new Event('seeked'));
    expect((await pending).frames.get('scrub')?.exact).toBe(false);
    pool.dispose();
  });
  it('uses explicit encoded mask timing/rate instead of multiplying raw source-clip timing twice', async () => {
    const { pool, videos } = setup();
    const mask = {
      ...request('mask', 0, 'mask'),
      sourceTiming: { timelineTime: 5, mediaTime: 3, rate: 0.25 },
    };
    const pending = pool.sync([mask], { time: 6, playing: true, rate: 2 });
    videos[0]?.present(3.25);
    const result = await pending;
    expect(result.frames.get('mask')?.sourceTime).toBe(3.25);
    expect(result.frames.get('mask')?.exact).toBe(true);
    expect(videos[0]?.playbackRate).toBe(0.5);
    expect(videos[0]?.muted).toBe(true);
    pool.dispose();
  });
  it('keeps zero-rate mask boundary samples frozen and flags legacy missing timing descriptors', async () => {
    const { pool, videos } = setup();
    const mask = {
      ...request('mask', 0, 'mask'),
      sourceTiming: { timelineTime: 0, mediaTime: 3, rate: 0 },
    };
    const pending = pool.sync([mask], { time: 1, playing: true });
    videos[0]?.present(3);
    await pending;
    expect(videos[0]?.paused).toBe(true);
    const legacy = pool.sync([request('mask', 0, 'mask')], {
      time: 1,
      playing: false,
    });
    videos[0]?.present(3.5);
    const result = await legacy;
    expect(result.frames.get('mask')?.exact).toBe(false);
    expect(result.issues.join()).toContain('descriptor missing');
    pool.dispose();
  });
});
