import type { MediaKind } from '../uploads/types';
import { deleteMedia, readMedia, writeMedia } from './cache';
import { peaksOffThread } from './peaks';
export interface MediaMetadata {
  durationSec?: number;
  width?: number;
  height?: number;
  thumbBlobUrl?: string;
  filmstripBlobUrls?: string[];
  waveform?: Float32Array;
  previewUnsupported?: boolean;
}
export function mediaKind(file: Pick<File, 'type'>): MediaKind {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  return 'doc';
}
export function releaseMetadata(meta: MediaMetadata): void {
  if (typeof URL.revokeObjectURL !== 'function') return;
  if (meta.thumbBlobUrl) URL.revokeObjectURL(meta.thumbBlobUrl);
  meta.filmstripBlobUrls?.forEach((url) => URL.revokeObjectURL(url));
}
function check(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
}
function event(
  target: HTMLMediaElement,
  name: string,
  signal: AbortSignal,
  action?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    check(signal);
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(name, ready);
      target.removeEventListener('error', fail);
      signal.removeEventListener('abort', cancel);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('Unsupported media'));
    };
    const cancel = () => {
      cleanup();
      reject(new DOMException('Canceled', 'AbortError'));
    };
    const timer = setTimeout(fail, 15000);
    target.addEventListener(name, ready, { once: true });
    target.addEventListener('error', fail, { once: true });
    signal.addEventListener('abort', cancel, { once: true });
    action?.();
  });
}
async function withVideo<T>(
  file: File,
  signal: AbortSignal,
  fn: (video: HTMLVideoElement) => Promise<T>,
): Promise<T> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.playsInline = true;
  try {
    await event(video, 'loadedmetadata', signal, () => {
      video.src = url;
    });
    return await fn(video);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
async function jpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(source, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('JPEG unavailable'))),
      'image/jpeg',
      0.8,
    ),
  );
}
async function seek(
  video: HTMLVideoElement,
  time: number,
  signal: AbortSignal,
) {
  if (video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.001)
    return;
  await event(video, 'seeked', signal, () => {
    video.currentTime = time;
  });
}
export async function probeMedia(
  file: File,
  localId: string,
  signal: AbortSignal,
): Promise<MediaMetadata> {
  if (mediaKind(file) === 'doc') return {};
  if (
    typeof document === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  )
    return { previewUnsupported: true };
  const meta: MediaMetadata = {};
  try {
    check(signal);
    if (mediaKind(file) === 'video') {
      await withVideo(file, signal, async (video) => {
        meta.width = video.videoWidth;
        meta.height = video.videoHeight;
        if (Number.isFinite(video.duration)) meta.durationSec = video.duration;
        await seek(video, Math.min(1, (meta.durationSec ?? 0) * 0.1), signal);
        const portrait = video.videoHeight > video.videoWidth;
        const thumbnail = await jpeg(
          video,
          portrait ? 90 : 160,
          portrait ? 160 : 90,
        );
        check(signal);
        meta.thumbBlobUrl = URL.createObjectURL(thumbnail);
        await writeMedia(localId, { thumbnail });
      });
    } else if (mediaKind(file) === 'image') {
      const bitmap = await createImageBitmap(file);
      try {
        meta.width = bitmap.width;
        meta.height = bitmap.height;
        const scale = 160 / Math.max(bitmap.width, bitmap.height);
        const thumbnail = await jpeg(
          bitmap,
          Math.max(1, Math.round(bitmap.width * scale)),
          Math.max(1, Math.round(bitmap.height * scale)),
        );
        check(signal);
        meta.thumbBlobUrl = URL.createObjectURL(thumbnail);
        await writeMedia(localId, { thumbnail });
      } finally {
        bitmap.close();
      }
    } else {
      const audio = document.createElement('audio');
      const url = URL.createObjectURL(file);
      try {
        await event(audio, 'loadedmetadata', signal, () => {
          audio.src = url;
        });
        if (Number.isFinite(audio.duration)) meta.durationSec = audio.duration;
      } finally {
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
      }
    }
    check(signal);
    return meta;
  } catch (error) {
    if (signal.aborted) {
      releaseMetadata(meta);
      await deleteMedia(localId);
      throw error;
    }
    return { ...meta, previewUnsupported: true };
  }
}
/** Lazy after the first PUT starts. DOM decode cannot run inside a Worker. */
export async function prepareTimeline(
  file: File,
  localId: string,
  meta: MediaMetadata,
  signal: AbortSignal,
): Promise<MediaMetadata> {
  if (typeof document === 'undefined') return {};
  const result: MediaMetadata = {};
  const cached = (await readMedia(localId)) ?? {};
  try {
    check(signal);
    if (
      mediaKind(file) === 'video' &&
      meta.durationSec &&
      !meta.previewUnsupported
    ) {
      const frames: Blob[] = [];
      await withVideo(file, signal, async (video) => {
        for (let i = 0; i < 8; i++) {
          check(signal);
          await seek(video, ((meta.durationSec ?? 0) * (i + 0.5)) / 8, signal);
          frames.push(
            await jpeg(
              video,
              Math.max(
                1,
                Math.round((80 * video.videoWidth) / video.videoHeight),
              ),
              80,
            ),
          );
        }
      });
      cached.frames = frames;
      check(signal);
      result.filmstripBlobUrls = frames.map((blob) =>
        URL.createObjectURL(blob),
      );
    }
  } catch {
    /* Preview failure cannot block uploads or audio prep. */
  }
  try {
    check(signal);
    const kind = mediaKind(file);
    if (
      (kind === 'audio' || kind === 'video') &&
      meta.durationSec !== undefined &&
      meta.durationSec <= 600 &&
      typeof OfflineAudioContext !== 'undefined'
    ) {
      const decoder = new OfflineAudioContext(1, 1, 8000);
      const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
      check(signal);
      if (decoded.duration <= 600) {
        const renderer = new OfflineAudioContext(
          1,
          Math.max(1, Math.ceil(decoded.duration * 8000)),
          8000,
        );
        const source = renderer.createBufferSource();
        source.buffer = decoded;
        source.connect(renderer.destination);
        source.start();
        const mono = await renderer.startRendering();
        check(signal);
        const peaks = await peaksOffThread(mono.getChannelData(0), signal);
        result.waveform = peaks.waveform;
        cached.waveform = peaks.waveform;
        cached.timelinePeaks = peaks.timelinePeaks;
      }
    }
  } catch {
    /* Unsupported codecs still upload. */
  }
  if (signal.aborted) {
    releaseMetadata(result);
    await deleteMedia(localId);
    return {};
  }
  await writeMedia(localId, cached);
  if (signal.aborted) {
    releaseMetadata(result);
    await deleteMedia(localId);
    return {};
  }
  return result;
}
