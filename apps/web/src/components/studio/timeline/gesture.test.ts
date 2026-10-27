import { describe, expect, it, vi } from 'vitest';
import type { EditingAPI } from '@/lib/editing/types';
import { TimelineGesture } from './gesture';
import { project } from './test-fixtures';
function harness() {
  const beginEdit = vi.fn(() => 'transaction');
  const previewEdit = vi.fn();
  const commitEdit = vi.fn(async () => ({
    id: 'transaction',
    status: 'acknowledged' as const,
  }));
  const cancelEdit = vi.fn();
  let callback: FrameRequestCallback | undefined;
  const schedule = vi.fn((cb: FrameRequestCallback) => {
    callback = cb;
    return 1;
  });
  const unschedule = vi.fn();
  const api = {
    beginEdit,
    previewEdit,
    commitEdit,
    cancelEdit,
  } as unknown as EditingAPI;
  return {
    gesture: new TimelineGesture(
      project(),
      api,
      ['a'],
      'move clips',
      schedule,
      unschedule,
    ),
    beginEdit,
    previewEdit,
    commitEdit,
    cancelEdit,
    unschedule,
    schedule,
    frame: () => callback?.(0),
  };
}
describe('gesture lifecycle', () => {
  it('coalesces repeated local previews and commits latest ops exactly once', async () => {
    const h = harness();
    const op = { op: 'clip.move' as const, id: 'a', trackId: 'v', start: 6 };
    h.gesture.preview([op]);
    h.gesture.preview([{ ...op, start: 7 }]);
    expect(h.schedule).toHaveBeenCalledTimes(1);
    expect(h.previewEdit).not.toHaveBeenCalled();
    h.frame();
    expect(h.previewEdit).toHaveBeenCalledWith('transaction', [
      { ...op, start: 7 },
    ]);
    expect(h.commitEdit).not.toHaveBeenCalled();
    await h.gesture.finish();
    await h.gesture.finish();
    expect(h.commitEdit).toHaveBeenCalledTimes(1);
    expect(h.commitEdit).toHaveBeenCalledWith('transaction', [
      { ...op, start: 7 },
    ]);
  });
  it('flushes final pending ops on release without another frame or HTTP per move', async () => {
    const h = harness();
    h.gesture.preview([{ op: 'clip.remove', id: 'a' }]);
    await h.gesture.finish();
    expect(h.unschedule).toHaveBeenCalledWith(1);
    h.frame();
    expect(h.previewEdit).not.toHaveBeenCalled();
    expect(h.commitEdit).toHaveBeenCalledTimes(1);
  });
  it('rolls back on cancel/unmount and never commits after cancellation', () => {
    const h = harness();
    h.gesture.preview([]);
    h.gesture.cancel();
    h.gesture.cancel();
    h.frame();
    h.gesture.finish();
    expect(h.cancelEdit).toHaveBeenCalledTimes(1);
    expect(h.commitEdit).not.toHaveBeenCalled();
    expect(h.previewEdit).not.toHaveBeenCalled();
  });
});
