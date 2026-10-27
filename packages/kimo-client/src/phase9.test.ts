import { describe, expect, it, vi } from 'vitest';
import {
  KimoClient,
  approvalOptionsSchema,
  renderSchema,
  videoSchema,
} from './index';
describe('Phase 9 additive API', () => {
  it('retains legacy payloads without inserting optional facts', () => {
    expect(approvalOptionsSchema.parse({})).toEqual({});
    expect(
      renderSchema.parse({
        status: 'rendering',
        progress: 0,
        frame: 0.5,
        totalFrames: 1.5,
        etaSec: 2,
      }),
    ).not.toHaveProperty('fps');
    expect(
      videoSchema.parse({
        url: 'u',
        posterUrl: 'p',
        durationSec: 8,
        width: 1920,
        height: 1080,
        sizeBytes: 1,
        title: 't',
      }),
    ).not.toHaveProperty('audio');
    for (const value of [
      { title: ' ' },
      { preset: '4k' },
      { expectedProjectVersion: 0.1 },
      { expectedProjectVersion: -1 },
      { burnInCaptions: 'yes' },
      { unknown: true },
    ])
      expect(approvalOptionsSchema.safeParse(value).success).toBe(false);
  });
  it('encodes IDs, validates discrete frames and forwards signals on every new method', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = String(url);
      return new Response(
        JSON.stringify(
          path.endsWith('/approve')
            ? { renderId: 'r' }
            : path.endsWith('/cancel')
              ? { status: 'cancelled', sessionId: 's' }
              : path.endsWith('/reopen')
                ? { status: 'editing' }
                : path.includes('/renders/')
                  ? {
                      status: 'rendering',
                      progress: 0,
                      frame: 0,
                      totalFrames: 240,
                      etaSec: 2,
                    }
                  : {
                      url: 'u',
                      posterUrl: 'p',
                      durationSec: 8,
                      width: 1080,
                      height: 1920,
                      sizeBytes: 1,
                      title: 't',
                    },
        ),
      );
    });
    const client = new KimoClient('http://mock', request);
    const signal = new AbortController().signal;
    await client.approve('a/b', undefined, { signal });
    await client.render('a/b', { signal });
    await client.video('a/b', { signal });
    await client.cancelRender('a/b', { signal });
    await client.reopenSession('a/b', { signal });
    for (const [url, init] of request.mock.calls) {
      expect(String(url)).toContain('a%2Fb');
      expect(init?.signal).toBe(signal);
    }
    expect(request.mock.calls[0]?.[1]?.body).toBe('{}');
    expect(client.renderFrameUrl('a/b', 12)).toBe(
      'http://mock/v1/renders/a%2Fb/frame.jpg?n=12',
    );
    for (const n of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => client.renderFrameUrl('r', n)).toThrow();
  });
});
