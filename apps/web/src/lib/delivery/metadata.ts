import type { Metadata } from 'next';
import type { Video } from '@kimo/client';
import { safeMediaUrl } from './format';
export function deliveryMetadata(video: Video): Metadata {
  const media = safeMediaUrl(video.url);
  const poster = safeMediaUrl(video.posterUrl);
  return {
    title: video.title,
    description: 'made with kimo, the ai video editor',
    robots: { index: false, follow: false },
    openGraph: {
      type: 'video.other',
      title: video.title,
      description: 'made with kimo, the ai video editor',
      ...(media
        ? {
            videos: [
              {
                url: media,
                type: 'video/mp4',
                width: video.width,
                height: video.height,
              },
            ],
          }
        : {}),
      ...(poster
        ? {
            images: [{ url: poster, width: video.width, height: video.height }],
          }
        : {}),
    },
  };
}
