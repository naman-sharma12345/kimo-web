import type { SessionSnapshot } from '@kimo/client';
import type { UploadItem } from '@/lib/uploads/types';
export interface UploadQueue {
  getState(): {
    items: readonly UploadItem[];
    add(files: readonly File[]): string[];
  };
  subscribe(listener: () => void): () => void;
}
/** Uses existing upload and message-attachment contracts. Never starts another session. */
export async function attachSessionUploads(input: {
  files: readonly File[];
  queue: UploadQueue;
  signal: AbortSignal;
  send(attachments: string[]): Promise<unknown>;
  refresh(): Promise<SessionSnapshot>;
  remember(mapping: Record<string, string>): void;
  accepted(snapshot: SessionSnapshot): void;
}): Promise<readonly string[]> {
  if (input.signal.aborted) throw new DOMException('Canceled', 'AbortError');
  if (!input.files.length) return [];
  const ids = input.queue.getState().add(input.files);
  const completed = await new Promise<readonly UploadItem[]>(
    (resolve, reject) => {
      let stop = () => {};
      const cleanup = () => {
        stop();
        input.signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        reject(new DOMException('Canceled', 'AbortError'));
      };
      const check = () => {
        const items = ids.map((id) =>
          input.queue.getState().items.find((item) => item.localId === id),
        );
        const failed = items.find(
          (item) =>
            !item || item.status === 'error' || item.status === 'canceled',
        );
        if (items.some((item) => !item) || failed) {
          cleanup();
          reject(new Error(failed?.error ?? 'an upload was canceled'));
          return;
        }
        if (
          items.every(
            (item): item is UploadItem =>
              !!item && item.status === 'done' && !!item.assetId,
          )
        ) {
          cleanup();
          resolve(items);
        }
      };
      stop = input.queue.subscribe(check);
      input.signal.addEventListener('abort', abort, { once: true });
      check();
    },
  );
  if (input.signal.aborted) throw new DOMException('Canceled', 'AbortError');
  const mapping = Object.fromEntries(
    completed.map((item) => {
      if (!item.assetId) throw new Error('completed upload has no asset ID');
      return [item.localId, item.assetId];
    }),
  );
  input.remember(mapping);
  // A failed/uncertain dispatch is not replayed. The caller can reconcile via session state.
  await input.send(Object.values(mapping));
  if (input.signal.aborted) return [];
  const snapshot = await input.refresh();
  if (input.signal.aborted) return [];
  if (
    !Object.values(mapping).every((id) =>
      snapshot.assets.some((asset) => asset.id === id),
    )
  )
    throw new Error(
      'upload completed, but the server has not confirmed attachment to this edit',
    );
  input.accepted({
    ...snapshot,
    assets: snapshot.assets.map((asset) => {
      const item = completed.find((item) => item.assetId === asset.id);
      return item
        ? {
            ...asset,
            ...(asset.durationSec === undefined &&
            item.meta.durationSec !== undefined
              ? { durationSec: item.meta.durationSec }
              : {}),
            ...(asset.width === undefined && item.meta.width !== undefined
              ? { width: item.meta.width }
              : {}),
            ...(asset.height === undefined && item.meta.height !== undefined
              ? { height: item.meta.height }
              : {}),
          }
        : asset;
    }),
  });
  return Object.values(mapping);
}
