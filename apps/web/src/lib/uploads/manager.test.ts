import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadClient } from './types';
import { createUploadManager, OFFLINE_MESSAGE } from './manager';
import { PART_SIZE, splitParts, RETRY_DELAYS } from './transport';
import { restoreUploadSession, sessionDestination } from './session';
import type { SessionSnapshot } from '@kimo/client';

class FakeXHR {
  static requests: FakeXHR[] = [];
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  status = 200;
  timeout = 0;
  url = '';
  body?: Blob;
  aborted = false;
  finished = false;
  headers: Record<string, string> = {};
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  getResponseHeader() {
    return `"etag-${this.url}"`;
  }
  send(body: Blob) {
    this.body = body;
    FakeXHR.requests.push(this);
  }
  abort() {
    this.aborted = true;
    this.finished = true;
    this.onabort?.();
  }
  progress(loaded: number) {
    this.upload.onprogress?.({ loaded } as ProgressEvent);
  }
  finish(status = 200) {
    this.status = status;
    this.finished = true;
    this.onload?.();
  }
  fail() {
    this.finished = true;
    this.onerror?.();
  }
}
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function file(name: string, size: number): File {
  const value = new File([], name, { type: 'application/octet-stream' });
  Object.defineProperty(value, 'size', { value: size });
  // Keep the fake 150 MB allocation-free, but exercise the real slicing boundaries.
  value.slice = vi.fn((start = 0, end = size) => {
    const part = new Blob();
    Object.defineProperty(part, 'size', { value: end - start });
    return part;
  });
  return value;
}
function setup(extra: Partial<Parameters<typeof createUploadManager>[0]> = {}) {
  const client: UploadClient = {
    uploads: vi.fn(async (files: Parameters<UploadClient['uploads']>[0]) => ({
      uploads: files.map((entry) => ({
        assetId: entry.name,
        putUrl: `/put/${entry.name}`,
        headers: { 'x-upload': 'yes' },
        ...(entry.size > 100 * 1024 * 1024
          ? {
              parts: Array.from(
                { length: Math.ceil(entry.size / PART_SIZE) },
                (_, index) => ({
                  partNumber: index + 1,
                  putUrl: `/part/${index + 1}`,
                }),
              ),
            }
          : {}),
      })),
    })),
    completeUpload: vi.fn(async () => ({ ok: true as const })),
    createSession: vi.fn(async () => ({
      sessionId: 'session-1',
      wsUrl: 'ws://localhost/session-1',
    })),
    session: vi.fn(),
    abortUpload: vi.fn(async () => undefined),
  };
  let next = 0;
  const manager = createUploadManager({
    client,
    id: () => `local-${++next}`,
    probe: async () => ({}),
    timeline: async () => ({}),
    xhr: () => new FakeXHR() as unknown as XMLHttpRequest,
    ...extra,
  });
  managers.push(manager);
  return { ...manager, client, state: () => manager.useUploads.getState() };
}
const managers: ReturnType<typeof createUploadManager>[] = [];
beforeEach(() => {
  FakeXHR.requests = [];
  sessionStorage.clear();
});
afterEach(() => {
  managers.splice(0).forEach((manager) => manager.dispose());
  vi.useRealTimers();
});

describe('upload pipeline', () => {
  it('probes in threes, batches presigning, uploads smallest first with three slots', async () => {
    const pending: (() => void)[] = [];
    let probing = 0;
    let maximum = 0;
    const manager = setup({
      probe: () =>
        new Promise((resolve) => {
          probing++;
          maximum = Math.max(maximum, probing);
          pending.push(() => {
            probing--;
            resolve({});
          });
        }),
    });
    manager
      .state()
      .add([
        file('five', 5),
        file('one', 1),
        file('three', 3),
        file('two', 2),
        file('four', 4),
      ]);
    expect(pending).toHaveLength(3);
    expect(manager.client.uploads).not.toHaveBeenCalled();
    pending.splice(0).forEach((done) => done());
    await flush();
    pending.splice(0).forEach((done) => done());
    await flush();
    expect(maximum).toBe(3);
    expect(manager.client.uploads).toHaveBeenCalledTimes(1);
    expect(FakeXHR.requests.map((xhr) => xhr.url)).toEqual([
      '/put/one',
      '/put/two',
      '/put/three',
    ]);
    FakeXHR.requests[0]?.progress(1);
    expect(
      manager.state().items.find((item) => item.file.name === 'one')?.progress,
    ).toBe(1);
    FakeXHR.requests[0]?.finish();
    await flush();
    expect(FakeXHR.requests).toHaveLength(4);
    FakeXHR.requests[1]?.finish();
    await flush();
    expect(FakeXHR.requests).toHaveLength(5);
    FakeXHR.requests.forEach((xhr) => {
      if (!xhr.finished) xhr.finish();
    });
    await flush();
    expect(manager.state().items.every((item) => item.status === 'done')).toBe(
      true,
    );
  });
  it('creates and persists a session before upload bytes finish, preserving exact prompt', async () => {
    const manager = setup();
    const ids = manager.state().add([file('clip', 10)]);
    const session = await manager
      .state()
      .startSession({ prompt: '  exact\nprompt  ', aspect: 'auto' });
    expect(session.prompt).toBe('  exact\nprompt  ');
    expect(session.assetLocalMap[ids[0] ?? '']).toBe('clip');
    expect(manager.state().items[0]?.status).toBe('uploading');
    expect(restoreUploadSession()).toEqual(session);
    expect(manager.client.createSession).toHaveBeenCalledWith({
      prompt: '  exact\nprompt  ',
      aspect: 'auto',
      assetIds: ['clip'],
    });
  });
  it('retries a PUT after 1/3/9 seconds then exposes an error and supports manual retry', async () => {
    vi.useFakeTimers();
    const manager = setup();
    const [id] = manager.state().add([file('clip', 20)]);
    await flush();
    for (const ms of RETRY_DELAYS) {
      const previous = FakeXHR.requests.length;
      FakeXHR.requests.at(-1)?.fail();
      await flush();
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(FakeXHR.requests).toHaveLength(previous);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeXHR.requests).toHaveLength(previous + 1);
    }
    FakeXHR.requests.at(-1)?.fail();
    await flush();
    expect(manager.state().items[0]?.status).toBe('error');
    manager.state().retry(id ?? '');
    await flush();
    FakeXHR.requests.at(-1)?.finish();
    await flush();
    expect(manager.state().items[0]?.status).toBe('done');
  });
  it('aborts on offline, resumes on online without consuming retry budget', async () => {
    const warning = vi.fn();
    const manager = setup({ onWarning: warning });
    manager.state().add([file('clip', 20)]);
    await flush();
    const first = FakeXHR.requests[0];
    first?.progress(10);
    manager.setOffline(true);
    await flush();
    expect(first?.aborted).toBe(true);
    expect(FakeXHR.requests).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith(OFFLINE_MESSAGE);
    manager.setOffline(false);
    await flush();
    expect(FakeXHR.requests).toHaveLength(2);
    FakeXHR.requests[1]?.finish();
    await flush();
    expect(manager.state().items[0]?.status).toBe('done');
  });
  it('cancels and removes an item, aborts XHR, and calls optional server cleanup', async () => {
    const manager = setup();
    const [id] = manager.state().add([file('clip', 20)]);
    await flush();
    manager.state().cancel(id ?? '');
    await flush();
    expect(FakeXHR.requests[0]?.aborted).toBe(true);
    expect(manager.state().items).toEqual([]);
    expect(manager.client.abortUpload).toHaveBeenCalledWith('clip');
  });
  it('splits 150 MiB into 16 MiB parts, limits concurrency to four, completes with ordered ETags', async () => {
    const manager = setup();
    const big = file('big', 150 * 1024 * 1024);
    expect(splitParts(big).map((part) => part.size)).toEqual([
      ...Array<number>(9).fill(PART_SIZE),
      6 * 1024 * 1024,
    ]);
    manager.state().add([big]);
    await flush();
    expect(FakeXHR.requests).toHaveLength(4);
    while (FakeXHR.requests.some((xhr) => !xhr.finished)) {
      FakeXHR.requests
        .filter((xhr) => !xhr.finished)
        .reverse()
        .forEach((xhr) => xhr.finish());
      await flush();
      expect(
        FakeXHR.requests.filter((xhr) => !xhr.finished).length,
      ).toBeLessThanOrEqual(4);
    }
    expect(FakeXHR.requests).toHaveLength(10);
    expect(manager.client.completeUpload).toHaveBeenCalledWith(
      'big',
      Array.from({ length: 10 }, (_, i) => ({
        partNumber: i + 1,
        etag: `"etag-/part/${i + 1}"`,
      })),
    );
    expect(manager.state().items[0]?.status).toBe('done');
  });
  it('retains successful parts through offline and cancels all concurrent multipart requests', async () => {
    const manager = setup();
    const [id] = manager.state().add([file('big', 150 * 1024 * 1024)]);
    await flush();
    FakeXHR.requests[0]?.finish();
    await flush();
    manager.setOffline(true);
    await flush();
    expect(FakeXHR.requests.filter((xhr) => !xhr.finished)).toHaveLength(0);
    manager.setOffline(false);
    await flush();
    expect(
      FakeXHR.requests.filter((xhr) => xhr.url === '/part/1'),
    ).toHaveLength(1);
    manager.state().cancel(id ?? '');
    await flush();
    expect(FakeXHR.requests.filter((xhr) => !xhr.finished)).toHaveLength(0);
    expect(manager.client.completeUpload).not.toHaveBeenCalled();
  });
  it('defers presign while offline and does not resurrect an item canceled during probe', async () => {
    let finish: ((meta: Record<string, never>) => void) | undefined;
    const manager = setup({
      probe: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    manager.setOffline(true);
    const [id] = manager.state().add([file('clip', 20)]);
    manager.state().cancel(id ?? '');
    finish?.({});
    await flush();
    manager.setOffline(false);
    await flush();
    expect(manager.client.uploads).not.toHaveBeenCalled();
    expect(manager.state().items).toEqual([]);
  });
  it('binds beforeunload/offline and leaves uploads alive when provider listeners detach', async () => {
    const manager = setup();
    const detach = manager.attachBrowserEvents();
    manager.state().add([file('clip', 20)]);
    await flush();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    window.dispatchEvent(new Event('offline'));
    await flush();
    expect(manager.state().offline).toBe(true);
    window.dispatchEvent(new Event('online'));
    await flush();
    detach();
    expect(FakeXHR.requests.at(-1)?.aborted).toBe(false);
    FakeXHR.requests.at(-1)?.finish();
    await flush();
    expect(manager.state().items[0]?.status).toBe('done');
  });
  it('keeps 100 MiB as a single PUT', async () => {
    const manager = setup();
    manager.state().add([file('edge', 100 * 1024 * 1024)]);
    await flush();
    expect(FakeXHR.requests).toHaveLength(1);
    expect(FakeXHR.requests[0]?.url).toBe('/put/edge');
  });
  it('retries only the failed multipart part and never retransmits a completed part', async () => {
    vi.useFakeTimers();
    const manager = setup();
    manager.state().add([file('big', 150 * 1024 * 1024)]);
    await flush();
    FakeXHR.requests[0]?.finish();
    FakeXHR.requests[1]?.fail();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      FakeXHR.requests.filter((request) => request.url === '/part/1'),
    ).toHaveLength(1);
    expect(
      FakeXHR.requests.filter((request) => request.url === '/part/2'),
    ).toHaveLength(2);
    while (FakeXHR.requests.some((request) => !request.finished)) {
      FakeXHR.requests
        .filter((request) => !request.finished)
        .forEach((request) => request.finish());
      await flush();
    }
    expect(manager.state().items[0]?.status).toBe('done');
  });
  it('cleans a presigned response arriving after cancellation without starting XHR', async () => {
    const manager = setup();
    let resolve:
      | ((response: Awaited<ReturnType<UploadClient['uploads']>>) => void)
      | undefined;
    vi.mocked(manager.client.uploads).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const [id] = manager.state().add([file('late', 10)]);
    await flush();
    manager.state().cancel(id ?? '');
    resolve?.({ uploads: [{ assetId: 'late', putUrl: '/late', headers: {} }] });
    await flush();
    expect(FakeXHR.requests).toHaveLength(0);
    expect(manager.client.abortUpload).toHaveBeenCalledWith('late');
  });
  it('does not block upload on probe failure and drops canceled session attachments from storage', async () => {
    const manager = setup({
      probe: async () => {
        throw new Error('Codec unavailable');
      },
    });
    const [id] = manager.state().add([file('clip', 10)]);
    await manager.state().startSession({ prompt: 'hello', aspect: 'auto' });
    expect(manager.state().items[0]?.meta.previewUnsupported).toBe(true);
    manager.state().cancel(id ?? '');
    expect(restoreUploadSession()?.attachments).toEqual([]);
    expect(restoreUploadSession()?.assetLocalMap).toEqual({});
  });
  it('returns correct deep-link destinations and safely ignores corrupt storage', () => {
    for (const [status, href] of [
      ['warming', '/warmup/s'],
      ['rendering', '/render/s'],
      ['done', '/v/v'],
    ] as const)
      expect(
        sessionDestination('s', { status, videoId: 'v' } as SessionSnapshot),
      ).toEqual({ kind: 'redirect', href });
    expect(
      sessionDestination('s', { status: 'failed' } as SessionSnapshot),
    ).toEqual({ kind: 'error' });
    expect(
      sessionDestination('s', { status: 'editing' } as SessionSnapshot),
    ).toEqual({ kind: 'studio' });
    sessionStorage.setItem('kimo.upload-session.v1', '{bad');
    expect(restoreUploadSession()).toBeUndefined();
  });
});
