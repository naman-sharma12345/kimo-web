'use client';
import { create, type UseBoundStore, type StoreApi } from 'zustand';
import { api } from '../api';
import { deleteMedia } from '../media/cache';
import {
  mediaKind,
  prepareTimeline,
  probeMedia,
  releaseMetadata,
} from '../media/probe';
import {
  abortError,
  isAbort,
  MULTIPART_THRESHOLD,
  PART_SIZE,
  putBlob,
  RETRY_DELAYS,
  sleep,
  splitParts,
} from './transport';
import { persistSession, restoreUploadSession } from './session';
import type {
  PresignedUpload,
  StartSessionInput,
  UploadClient,
  UploadItem,
  UploadSession,
} from './types';

export const OFFLINE_MESSAGE =
  'you’re offline. uploads will continue when you’re back.';
export interface UploadState {
  items: UploadItem[];
  offline: boolean;
  session?: UploadSession;
  add: (files: readonly File[]) => string[];
  cancel: (localId: string) => void;
  retry: (localId: string) => void;
  startSession: (input: StartSessionInput) => Promise<UploadSession>;
}
export interface UploadManagerOptions {
  client: UploadClient;
  xhr?: () => XMLHttpRequest;
  probe?: typeof probeMedia;
  timeline?: typeof prepareTimeline;
  sleep?: typeof sleep;
  id?: () => string;
  onWarning?: (message: string) => void;
}
interface Runtime {
  life: AbortController;
  attempts: Set<AbortController>;
  signed?: PresignedUpload;
  completed: Map<number, string>;
  running: boolean;
  prepared: boolean;
  lazyStarted: boolean;
}
/** Factory for tests or isolated consumers; production uses the singleton below. */
export function createUploadManager(options: UploadManagerOptions) {
  const runtime = new Map<string, Runtime>();
  const probe = options.probe ?? probeMedia;
  const timeline = options.timeline ?? prepareTimeline;
  const delay = options.sleep ?? sleep;
  let preparing = false;
  let disposed = false;
  let active = 0;
  let timelineQueue = Promise.resolve();
  let sessionRequest: Promise<UploadSession> | undefined;
  let detach: (() => void) | undefined;
  const store: UseBoundStore<StoreApi<UploadState>> = create<UploadState>(
    () => ({
      items: [],
      offline: false,
      add(files) {
        if (disposed) throw new Error('Upload manager disposed');
        const items = files.map((file): UploadItem => {
          const localId = options.id?.() ?? crypto.randomUUID();
          runtime.set(localId, {
            life: new AbortController(),
            attempts: new Set(),
            completed: new Map(),
            running: false,
            prepared: false,
            lazyStarted: false,
          });
          return {
            localId,
            file,
            kind: mediaKind(file),
            status: 'queued',
            progress: 0,
            bytesSent: 0,
            meta: {},
          };
        });
        store.setState((state) => ({ items: [...state.items, ...items] }));
        void prepare();
        return items.map((item) => item.localId);
      },
      cancel(localId) {
        const item = find(localId);
        const task = runtime.get(localId);
        task?.life.abort();
        task?.attempts.forEach((attempt) => attempt.abort());
        if (item) releaseMetadata(item.meta);
        void deleteMedia(localId);
        runtime.delete(localId);
        store.setState((state) => ({
          items: state.items.filter((entry) => entry.localId !== localId),
        }));
        const session = store.getState().session;
        if (session && localId in session.assetLocalMap) {
          const assetLocalMap = Object.fromEntries(
            Object.entries(session.assetLocalMap).filter(
              ([id]) => id !== localId,
            ),
          );
          const updated = {
            ...session,
            assetLocalMap,
            attachments: session.attachments.filter(
              (attachment) => attachment.localId !== localId,
            ),
          };
          persistSession(updated);
          store.setState({ session: updated });
        }
        if (task?.signed && options.client.abortUpload)
          void options.client
            .abortUpload(task.signed.assetId)
            .catch(() => undefined);
      },
      retry(localId) {
        const item = find(localId);
        const task = runtime.get(localId);
        if (!item || !task || item.status !== 'error' || task.running) return;
        patch(localId, { status: 'queued', error: undefined });
        if (task.signed) {
          task.prepared = true;
          pump();
        } else {
          task.prepared = false;
          void prepare();
        }
      },
      startSession(input) {
        // Share only the pending request. After creation the same manager represents that session.
        if (store.getState().session)
          return Promise.resolve(store.getState().session as UploadSession);
        if (sessionRequest) return sessionRequest;
        sessionRequest = start(input).finally(() => {
          sessionRequest = undefined;
        });
        return sessionRequest;
      },
    }),
  );
  function find(id: string) {
    return store.getState().items.find((item) => item.localId === id);
  }
  function patch(id: string, value: Partial<UploadItem>) {
    store.setState((state) => ({
      items: state.items.map((item) =>
        item.localId === id ? { ...item, ...value } : item,
      ),
    }));
  }
  function waitFor(
    predicate: () => boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        unsubscribe();
        signal?.removeEventListener('abort', cancel);
      };
      const cancel = () => {
        cleanup();
        reject(abortError());
      };
      const unsubscribe = store.subscribe(() => {
        if (predicate()) {
          cleanup();
          resolve();
        }
      });
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }
  async function online(signal: AbortSignal) {
    await waitFor(() => !store.getState().offline, signal);
  }
  async function networkCall<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    while (!disposed) {
      await waitFor(() => !store.getState().offline || disposed, signal);
      if (disposed || signal?.aborted) throw abortError();
      try {
        return await operation();
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (!store.getState().offline) throw error;
      }
    }
    throw abortError();
  }
  async function prepare() {
    if (preparing || disposed) return;
    preparing = true;
    const batch = store
      .getState()
      .items.filter(
        (item) =>
          item.status === 'queued' && !runtime.get(item.localId)?.signed,
      )
      .sort((a, b) => a.file.size - b.file.size);
    let cursor = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(3, batch.length) }, async () => {
          while (cursor < batch.length) {
            const item = batch[cursor++];
            if (!item) continue;
            const task = runtime.get(item.localId);
            if (!task) continue;
            patch(item.localId, { status: 'probing' });
            try {
              const meta = await probe(
                item.file,
                item.localId,
                task.life.signal,
              );
              if (!runtime.has(item.localId)) releaseMetadata(meta);
              else patch(item.localId, { meta });
            } catch (error) {
              if (!task.life.signal.aborted)
                patch(item.localId, {
                  meta: { previewUnsupported: true },
                  error: error instanceof Error ? error.message : undefined,
                });
            }
          }
        }),
      );
      const ready = batch.filter((item) => runtime.has(item.localId));
      if (!ready.length) return;
      // Offline blocks presign too. Canceled items are filtered again after wake.
      await waitFor(() => !store.getState().offline || disposed);
      if (disposed) return;
      const sending = ready.filter((item) => runtime.has(item.localId));
      if (!sending.length) return;
      const response = await networkCall(() =>
        options.client.uploads(
          sending.map(({ file }) => ({
            name: file.name,
            size: file.size,
            mime: file.type,
          })),
        ),
      );
      if (response.uploads.length !== sending.length)
        throw new Error('Invalid presign response count');
      sending.forEach((item, index) => {
        const signed = response.uploads[index];
        const task = runtime.get(item.localId);
        if (!task || !signed) {
          if (signed && options.client.abortUpload)
            void options.client
              .abortUpload(signed.assetId)
              .catch(() => undefined);
          return;
        }
        task.signed = signed;
        task.prepared = true;
        patch(item.localId, {
          assetId: signed.assetId,
          status: 'queued',
          error: undefined,
        });
      });
    } catch (error) {
      for (const item of batch)
        if (runtime.has(item.localId))
          patch(item.localId, { status: 'error', error: message(error) });
    } finally {
      preparing = false;
      pump();
      if (
        store
          .getState()
          .items.some(
            (item) =>
              item.status === 'queued' && !runtime.get(item.localId)?.signed,
          )
      )
        void prepare();
    }
  }
  function message(error: unknown) {
    return error instanceof Error ? error.message : 'Upload failed';
  }
  function pump() {
    if (disposed || store.getState().offline) return;
    const ready = store
      .getState()
      .items.filter(
        (item) =>
          item.status === 'queued' && runtime.get(item.localId)?.prepared,
      )
      .sort((a, b) => a.file.size - b.file.size);
    for (const item of ready) {
      if (active >= 3) break;
      const task = runtime.get(item.localId);
      if (!task || task.running) continue;
      active++;
      task.running = true;
      void upload(item, task)
        .catch((error: unknown) => {
          if (!task.life.signal.aborted)
            patch(item.localId, { status: 'error', error: message(error) });
        })
        .finally(() => {
          active--;
          task.running = false;
          pump();
        });
    }
  }
  async function transfer(
    item: UploadItem,
    task: Runtime,
    url: string,
    body: Blob,
    progress: (bytes: number) => void,
  ): Promise<string> {
    let failures = 0;
    while (true) {
      await online(task.life.signal);
      const controller = new AbortController();
      task.attempts.add(controller);
      const cancel = () => controller.abort();
      task.life.signal.addEventListener('abort', cancel, { once: true });
      try {
        const request = putBlob(
          url,
          body,
          task.signed?.headers ?? {},
          controller.signal,
          progress,
          options.xhr,
        );
        startTimeline(item, task);
        return await request;
      } catch (error) {
        if (task.life.signal.aborted) throw abortError();
        progress(0);
        if (store.getState().offline || isAbort(error)) continue;
        const ms = RETRY_DELAYS[failures++];
        if (ms === undefined) throw error;
        await delay(ms, task.life.signal);
      } finally {
        task.attempts.delete(controller);
        task.life.signal.removeEventListener('abort', cancel);
      }
    }
  }
  function startTimeline(item: UploadItem, task: Runtime) {
    if (!task.lazyStarted) {
      task.lazyStarted = true;
      timelineQueue = timelineQueue
        .then(async () => {
          if (task.life.signal.aborted) return;
          const meta = await timeline(
            item.file,
            item.localId,
            find(item.localId)?.meta ?? {},
            task.life.signal,
          );
          if (task.life.signal.aborted || !find(item.localId))
            releaseMetadata(meta);
          else
            patch(item.localId, {
              meta: { ...find(item.localId)?.meta, ...meta },
            });
        })
        .catch(() => undefined);
    }
  }
  async function upload(item: UploadItem, task: Runtime) {
    const signed = task.signed;
    if (!signed) throw new Error('Missing upload URL');
    patch(item.localId, { status: 'uploading', error: undefined });
    const chunks =
      item.file.size > MULTIPART_THRESHOLD
        ? splitParts(item.file)
        : [item.file];
    const multipart = item.file.size > MULTIPART_THRESHOLD;
    if (
      multipart &&
      (!signed.parts ||
        signed.parts.length !== chunks.length ||
        signed.parts.some((part, index) => part.partNumber !== index + 1))
    )
      throw new Error('Invalid multipart upload plan');
    const sent = chunks.map((blob, index) =>
      task.completed.has(index + 1) ? blob.size : 0,
    );
    const progress = (index: number, bytes: number) => {
      sent[index] = bytes;
      const bytesSent = sent.reduce((sum, value) => sum + value, 0);
      patch(item.localId, {
        bytesSent,
        progress: item.file.size ? Math.min(1, bytesSent / item.file.size) : 0,
      });
    };
    let cursor = 0;
    let failure: unknown;
    await Promise.all(
      Array.from(
        { length: multipart ? Math.min(4, chunks.length) : 1 },
        async () => {
          while (cursor < chunks.length && !failure) {
            const index = cursor++;
            const blob = chunks[index];
            if (!blob || task.completed.has(index + 1)) continue;
            try {
              const url = multipart
                ? signed.parts?.[index]?.putUrl
                : signed.putUrl;
              if (!url) throw new Error('Missing part URL');
              const etag = await transfer(item, task, url, blob, (bytes) =>
                progress(index, bytes),
              );
              if (multipart && !etag)
                throw new Error(
                  'Multipart requires an exposed ETag response header',
                );
              task.completed.set(index + 1, etag);
            } catch (error) {
              failure = error;
            }
          }
        },
      ),
    );
    if (failure) throw failure;
    if (task.life.signal.aborted) throw abortError();
    if (multipart) {
      await online(task.life.signal);
      await networkCall(
        () =>
          options.client.completeUpload(
            signed.assetId,
            [...task.completed]
              .sort(([a], [b]) => a - b)
              .map(([partNumber, etag]) => ({ partNumber, etag })),
          ),
        task.life.signal,
      );
    }
    if (!task.life.signal.aborted)
      patch(item.localId, {
        status: 'done',
        bytesSent: item.file.size,
        progress: 1,
      });
  }
  async function start(input: StartSessionInput): Promise<UploadSession> {
    const ids = store.getState().items.map((item) => item.localId);
    await waitFor(() =>
      ids.every(
        (id) =>
          !find(id) ||
          !!runtime.get(id)?.signed ||
          find(id)?.status === 'error',
      ),
    );
    const items = ids.map(find).filter((item): item is UploadItem => !!item);
    if (items.some((item) => !item.assetId))
      throw new Error('Some files could not be prepared for upload');
    if (disposed) throw abortError();
    await waitFor(() => !store.getState().offline || disposed);
    if (disposed) throw abortError();
    const response = await options.client.createSession({
      ...input,
      assetIds: items.map((item) => item.assetId as string),
    });
    const session: UploadSession = {
      ...response,
      prompt: input.prompt,
      assetLocalMap: Object.fromEntries(
        items.map((item) => [item.localId, item.assetId as string]),
      ),
      attachments: items.map((item) => ({
        localId: item.localId,
        assetId: item.assetId as string,
        name: item.file.name,
        size: item.file.size,
        kind: item.kind,
      })),
    };
    persistSession(session);
    store.setState({ session });
    return session;
  }
  function setOffline(offline: boolean) {
    if (store.getState().offline === offline) return;
    store.setState({ offline });
    if (offline) {
      options.onWarning?.(OFFLINE_MESSAGE);
      runtime.forEach((task) =>
        task.attempts.forEach((attempt) => attempt.abort()),
      );
    } else {
      pump();
      void prepare();
    }
  }
  function attachBrowserEvents(onWarning?: (message: string) => void) {
    if (typeof window === 'undefined') return () => undefined;
    if (detach) return detach;
    const offline = () => {
      if (!store.getState().offline) onWarning?.(OFFLINE_MESSAGE);
      setOffline(true);
    };
    const onlineEvent = () => setOffline(false);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        store
          .getState()
          .items.some((item) =>
            ['queued', 'probing', 'uploading'].includes(item.status),
          )
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', onlineEvent);
    window.addEventListener('beforeunload', beforeUnload);
    store.setState({ session: restoreUploadSession() });
    if (!navigator.onLine) offline();
    detach = () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', onlineEvent);
      window.removeEventListener('beforeunload', beforeUnload);
      detach = undefined;
    };
    return detach;
  }
  function dispose() {
    disposed = true;
    detach?.();
    for (const id of [...runtime.keys()]) store.getState().cancel(id);
    store.setState({ offline: false });
  }
  return { useUploads: store, attachBrowserEvents, setOffline, dispose };
}

export const uploadManager = createUploadManager({ client: api });
export const useUploads = uploadManager.useUploads;
/** Call in a root provider effect; detach only listeners on cleanup, never uploads. */
export const attachUploadBrowserEvents = uploadManager.attachBrowserEvents;
// Public byte sizes for parent integration and server contract coordination.
export { MULTIPART_THRESHOLD, PART_SIZE };
