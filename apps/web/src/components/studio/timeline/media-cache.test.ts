import { describe, expect, it, vi } from 'vitest';
import { TimelineMediaCache } from './media-cache';
import { clip } from './test-fixtures';
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
describe('injected compositor sampling lifecycle', () => {
  it('never launches more than two simultaneous jobs and bounds extraction width/points', async () => {
    const releases: (() => void)[] = [];
    const widths: number[] = [];
    const getFilmstrip = vi.fn(async (_id: string, width: number) => {
      widths.push(width);
      await new Promise<void>((resolve) => releases.push(resolve));
      return [];
    });
    const cache = new TimelineMediaCache({ getFilmstrip }, vi.fn());
    for (let i = 0; i < 10; i++) cache.request(clip(String(i)), 999999);
    expect(getFilmstrip).toHaveBeenCalledTimes(2);
    expect(widths).toEqual([1280, 1280]);
    releases[0]?.();
    await tick();
    expect(getFilmstrip).toHaveBeenCalledTimes(3);
    cache.dispose();
    releases.forEach((release) => release());
  });
  it('aborts stale work, discards queued jobs and prevents updates after disposal', async () => {
    const signals: AbortSignal[] = [];
    const releases: (() => void)[] = [];
    const changed = vi.fn();
    const cache = new TimelineMediaCache(
      {
        getWaveform: vi.fn(async (_id, _points, signal) => {
          if (signal) signals.push(signal);
          await new Promise<void>((resolve) => releases.push(resolve));
          return new Float32Array([0.5]);
        }),
      },
      changed,
    );
    for (let i = 0; i < 8; i++)
      cache.request(clip(String(i), { kind: 'audio' }), 200);
    cache.retain(new Set());
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    cache.dispose();
    releases.forEach((release) => release());
    await tick();
    expect(signals).toHaveLength(2);
    expect(changed).not.toHaveBeenCalled();
  });
  it('uses real waveform values, deduplicates exact requests and never fabricates unavailable media', async () => {
    const getWaveform = vi.fn(async () => new Float32Array([0.1, 0.8]));
    const changed = vi.fn();
    const cache = new TimelineMediaCache({ getWaveform }, changed);
    const c = clip('audio', { kind: 'audio', in: 4, speed: 2 });
    cache.request(c, 200);
    cache.request(c, 200);
    await tick();
    expect(getWaveform).toHaveBeenCalledTimes(1);
    expect(cache.read(c, 200)?.waveform).toEqual(new Float32Array([0.1, 0.8]));
    const absent = clip('empty', { kind: 'image' });
    cache.request(absent, 100);
    await tick();
    expect(cache.read(absent, 100)?.frames).toEqual([]);
    cache.dispose();
  });
  it('revokes only owned object URLs when a decoded image is evicted', async () => {
    const create = vi.fn(() => 'blob:owned');
    const revoke = vi.fn();
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        decode() {
          return Promise.resolve();
        }
      },
    );
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: create,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revoke,
    });
    const cache = new TimelineMediaCache(
      { getFilmstrip: async () => [{ time: 2, blob: new Blob(['real']) }] },
      vi.fn(),
    );
    const c = clip();
    cache.request(c, 100);
    await tick();
    expect(cache.read(c, 100)?.frames?.[0]?.time).toBe(2);
    cache.dispose();
    expect(revoke).toHaveBeenCalledWith('blob:owned');
    vi.unstubAllGlobals();
  });
  it('does not thrash or exceed a hard entry budget when more clips remain visible', async () => {
    const getFilmstrip = vi.fn(async () => []);
    const cache = new TimelineMediaCache({ getFilmstrip }, vi.fn(), 2, 3);
    for (let i = 0; i < 20; i++) cache.request(clip(String(i)), 100);
    await tick();
    await tick();
    expect(getFilmstrip).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 20; i++) cache.request(clip(String(i)), 100);
    await tick();
    expect(getFilmstrip).toHaveBeenCalledTimes(3);
    cache.retain(new Set());
    cache.request(clip('new'), 100);
    await tick();
    expect(getFilmstrip).toHaveBeenCalledTimes(4);
    cache.dispose();
  });
});
