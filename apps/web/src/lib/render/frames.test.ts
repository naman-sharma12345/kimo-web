import { describe, expect, it, vi } from 'vitest';
import { RenderFrames, type FrameResources, type RenderFrame } from './frames';
function resources() {
  let n = 0;
  const live = new Set<string>();
  const resources: FrameResources = {
    fetch: vi.fn(
      async () =>
        new Response(new Blob(['jpeg']), {
          headers: { 'content-type': 'image/jpeg' },
        }),
    ),
    create: vi.fn(() => {
      const url = `blob:${++n}`;
      live.add(url);
      return url;
    }),
    revoke: vi.fn((url) => {
      live.delete(url);
    }),
    decode: vi.fn(async () => {}),
  };
  return { resources, live };
}
describe('bounded illustrative render frame reel', () => {
  it('keeps eight URLs at most, ignores unchanged frames and revokes all on dispose', async () => {
    const { resources: r, live } = resources();
    let observed: readonly RenderFrame[] = [];
    const reel = new RenderFrames(r, (frames) => {
      observed = frames;
    });
    for (let i = 1; i <= 12; i++) {
      await reel.advance(i, '/actual.jpg');
      expect(live.size).toBeLessThanOrEqual(8);
    }
    expect(observed.map((item) => item.frame)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    await reel.advance(12, '/same.jpg');
    expect(r.fetch).toHaveBeenCalledTimes(12);
    reel.dispose();
    expect(live.size).toBe(0);
    expect(r.revoke).toHaveBeenCalledTimes(12);
  });
  it('ignores stale decode/fetch and revokes pending URLs on replacement/unmount', async () => {
    const { resources: r, live } = resources();
    const release: (() => void)[] = [];
    r.decode = () =>
      new Promise<void>((resolve) => {
        release.push(resolve);
      });
    const observe = vi.fn();
    const reel = new RenderFrames(r, observe);
    const first = reel.advance(1, '/1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = reel.advance(2, '/2');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(live.size).toBe(1);
    release[0]?.();
    await first;
    expect(observe).not.toHaveBeenCalled();
    reel.dispose();
    release[1]?.();
    await second;
    expect(observe).not.toHaveBeenCalled();
    expect(live.size).toBe(0);
  });
  it('never substitutes failed or non-JPEG content for a good frame', async () => {
    const { resources: r } = resources();
    const observe = vi.fn();
    const reel = new RenderFrames(r, observe);
    await reel.advance(1, '/1');
    r.fetch = vi.fn(
      async () =>
        new Response('PNG', { headers: { 'content-type': 'image/png' } }),
    );
    await reel.advance(2, '/2');
    expect(observe).toHaveBeenCalledOnce();
    reel.dispose();
  });
});
