import { describe, expect, it } from 'vitest';
import type { Video } from '@kimo/client';
import {
  downloadFilename,
  editAvailability,
  mediaTime,
  safeMediaUrl,
  shareLinks,
  videoMeta,
} from './format';
import { deliveryMetadata } from './metadata';
const video: Video = {
  title: 'server title',
  url: 'https://cdn.test/video.mp4?token=a%2Fb&n=1',
  posterUrl: 'https://cdn.test/poster.jpg',
  durationSec: 8,
  width: 1080,
  height: 1920,
  sizeBytes: 1234567,
};
describe('public server-driven delivery', () => {
  it('uses safe filename fallback and preserves title only as encoded local filename', () => {
    expect(downloadFilename('../Málaga / trip\u0000?')).toBe(
      'malaga-trip-kimo-1080p.mp4',
    );
    expect(downloadFilename('你好/..')).toBe('video-kimo-1080p.mp4');
    expect(downloadFilename('x'.repeat(1000)).length).toBeLessThan(120);
  });
  it('encodes actual full share links and preserves signed media URL', () => {
    const href = 'https://site.test/v/a%2Fb?x=1&next=two words';
    for (const link of shareLinks(href))
      expect(link.href).toContain(encodeURIComponent(href));
    expect(safeMediaUrl(video.url)).toBe(video.url);
    expect(safeMediaUrl('javascript:alert(1)')).toBeUndefined();
  });
  it('does not invent history, creation time or edit ownership/expiry', () => {
    expect(videoMeta(video)).toEqual(['1080 × 1920', '0:08', '1 MB']);
    expect(editAvailability(video, false)).toBe('unknown');
    expect(editAvailability({ ...video, sessionId: 's' }, true)).toBe(
      'unknown',
    );
    expect(
      editAvailability(
        { ...video, editExpiresAt: '2020-01-01T00:00:00Z' },
        false,
      ),
    ).toBe('expired');
    expect(
      editAvailability(
        { ...video, sessionId: 's', editExpiresAt: '2099-01-01T00:00:00Z' },
        true,
      ),
    ).toBe('available');
    expect(mediaTime(Infinity)).toBe('0:00');
  });
  it('generates noindex OG from server title, media, poster and actual portrait dimensions', () => {
    const metadata = deliveryMetadata(video);
    expect(metadata.title).toBe('server title');
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.openGraph).toMatchObject({
      title: 'server title',
      videos: [{ url: video.url, width: 1080, height: 1920 }],
      images: [{ url: video.posterUrl }],
    });
  });
});
