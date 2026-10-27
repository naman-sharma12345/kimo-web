/** This worker resizes/encodes decoded bitmaps. It cannot demux/decode an MP4. */
export interface FilmstripEncodeRequest {
  id: number;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}
export interface FilmstripEncodeResponse {
  id: number;
  blob?: Blob;
  error?: string;
}
export async function resizeFilmstripBitmap(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob> {
  try {
    if (typeof OffscreenCanvas === 'undefined')
      throw new Error('OffscreenCanvas unavailable');
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(width)),
      Math.max(1, Math.round(height)),
    );
    const context = canvas.getContext('2d');
    if (!context) throw new Error('OffscreenCanvas 2D unavailable');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  } finally {
    bitmap.close();
  }
}
interface EncodeWorkerScope {
  addEventListener(
    type: 'message',
    handler: (event: MessageEvent<FilmstripEncodeRequest>) => void,
  ): void;
  postMessage(data: FilmstripEncodeResponse): void;
}
// Guard against accidental main-thread import and server evaluation.
if (
  typeof document === 'undefined' &&
  typeof globalThis.postMessage === 'function'
) {
  const scope = globalThis as unknown as EncodeWorkerScope;
  scope.addEventListener('message', (event) => {
    const { id, bitmap, width, height } = event.data;
    void resizeFilmstripBitmap(bitmap, width, height).then(
      (blob) => scope.postMessage({ id, blob }),
      (error: unknown) =>
        scope.postMessage({
          id,
          error:
            error instanceof Error ? error.message : 'Bitmap encoding failed',
        }),
    );
  });
}
