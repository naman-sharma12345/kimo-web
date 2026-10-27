import type { Video } from '@kimo/client';
export function mediaTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
export function downloadFilename(title: string): string {
  const slug =
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100)
      .replace(/-+$/g, '') || 'video';
  return `${slug}-kimo-1080p.mp4`;
}
export function shareLinks(href: string): { label: string; href: string }[] {
  const encoded = encodeURIComponent(href);
  return [
    { label: 'X', href: `https://twitter.com/intent/tweet?url=${encoded}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${encoded}` },
    {
      label: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`,
    },
  ];
}
export function editAvailability(
  video: Video,
  canEdit: boolean,
  now = Date.now(),
): 'expired' | 'available' | 'unknown' {
  if (video.editExpiresAt && Date.parse(video.editExpiresAt) <= now)
    return 'expired';
  return canEdit && !!video.sessionId && !!video.editExpiresAt
    ? 'available'
    : 'unknown';
}
export function videoMeta(video: Video): string[] {
  const parts = [
    `${video.width} × ${video.height}`,
    mediaTime(video.durationSec),
    `${Math.round(video.sizeBytes / 1_000_000)} MB`,
  ];
  if (video.createdInSec !== undefined)
    parts.push(`made with kimo in ${Math.ceil(video.createdInSec / 60)} min`);
  return parts;
}
export function safeMediaUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url, 'https://kimo.invalid');
    return ['https:', 'http:'].includes(parsed.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}
