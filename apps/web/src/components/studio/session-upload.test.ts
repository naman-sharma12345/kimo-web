import { expect, it, vi } from 'vitest';
import type { UploadItem } from '@/lib/uploads/types';
import type { SessionSnapshot } from '@kimo/client';
import { attachSessionUploads } from './session-upload';
function setup() {
  let items: UploadItem[] = [];
  const listeners = new Set<() => void>();
  const file = new File(['abc'], 'clip.mp4', { type: 'video/mp4' });
  const snapshot: SessionSnapshot = {
    status: 'editing',
    project: {
      id: 'p',
      version: 0,
      fps: 30,
      width: 1920,
      height: 1080,
      duration: 5,
      tracks: [],
      clips: {},
      markers: [],
    },
    assets: [
      {
        id: 'asset',
        kind: 'video',
        name: 'clip.mp4',
        url: '/asset',
        source: 'user',
      },
    ],
  };
  const life = new AbortController();
  const queue = {
    getState: () => ({
      items,
      add: () => {
        items = [
          {
            localId: 'local',
            file,
            kind: 'video',
            status: 'uploading',
            progress: 0,
            bytesSent: 0,
            meta: {},
          },
        ];
        return ['local'];
      },
    }),
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const input = {
    files: [file],
    queue,
    signal: life.signal,
    send: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(snapshot),
    remember: vi.fn(),
    accepted: vi.fn(),
  };
  return {
    input,
    life,
    listeners,
    snapshot,
    update: (patch: Partial<UploadItem>) => {
      items = items.map((item) => ({ ...item, ...patch }));
      listeners.forEach((fn) => fn());
    },
  };
}
it('waits for actual upload completion, sends attachments exactly once, then requires snapshot confirmation', async () => {
  const s = setup();
  const task = attachSessionUploads(s.input);
  expect(s.input.send).not.toHaveBeenCalled();
  s.update({ status: 'done', assetId: 'asset' });
  await task;
  expect(s.input.remember).toHaveBeenCalledWith({ local: 'asset' });
  expect(s.input.send).toHaveBeenCalledExactlyOnceWith(['asset']);
  expect(s.input.accepted).toHaveBeenCalledWith(s.snapshot);
  expect(s.listeners.size).toBe(0);
});
it('disposal detaches the listener without canceling global uploads or dispatching a message', async () => {
  const s = setup();
  const task = attachSessionUploads(s.input);
  s.life.abort();
  await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  expect(s.listeners.size).toBe(0);
  expect(s.input.send).not.toHaveBeenCalled();
});
it('does not replay uncertain attachment dispatch', async () => {
  const s = setup();
  s.input.send.mockRejectedValue(new Error('timeout'));
  const task = attachSessionUploads(s.input);
  s.update({ status: 'done', assetId: 'asset' });
  await expect(task).rejects.toThrow('timeout');
  expect(s.input.send).toHaveBeenCalledTimes(1);
  expect(s.input.accepted).not.toHaveBeenCalled();
});
it('does not claim accepted upload association when a server ignores attachment IDs', async () => {
  const s = setup();
  s.input.refresh.mockResolvedValue({ ...s.snapshot, assets: [] });
  const task = attachSessionUploads(s.input);
  s.update({ status: 'done', assetId: 'asset' });
  await expect(task).rejects.toThrow('has not confirmed attachment');
  expect(s.input.accepted).not.toHaveBeenCalled();
});
it('rejects upload errors before any attachment dispatch', async () => {
  const s = setup();
  const task = attachSessionUploads(s.input);
  s.update({ status: 'error', error: 'failed upload' });
  await expect(task).rejects.toThrow('failed upload');
  expect(s.input.send).not.toHaveBeenCalled();
  expect(s.listeners.size).toBe(0);
});
