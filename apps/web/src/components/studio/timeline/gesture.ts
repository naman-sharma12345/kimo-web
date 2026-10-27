import type { KimoProject, Op } from '@kimo/client';
import type { EditingAPI } from '@/lib/editing/types';
/** One baseline, at most one pending animation frame, one commit on release. */
export class TimelineGesture {
  readonly id: string;
  private frame: number | null = null;
  private pending: readonly Op[] = [];
  private ended = false;
  constructor(
    readonly baseline: KimoProject,
    private editing: EditingAPI,
    ids: readonly string[],
    label: string,
    private schedule = requestAnimationFrame,
    private unschedule = cancelAnimationFrame,
  ) {
    this.id = editing.beginEdit({ clipIds: ids, label, source: 'timeline' });
  }
  preview(ops: readonly Op[]) {
    if (this.ended) return;
    this.pending = ops;
    if (this.frame === null)
      this.frame = this.schedule(() => {
        this.frame = null;
        if (!this.ended) this.editing.previewEdit(this.id, this.pending);
      });
  }
  finish() {
    if (this.ended) return;
    this.ended = true;
    if (this.frame !== null) this.unschedule(this.frame);
    this.frame = null;
    return this.editing.commitEdit(this.id, this.pending);
  }
  cancel() {
    if (this.ended) return;
    this.ended = true;
    if (this.frame !== null) this.unschedule(this.frame);
    this.frame = null;
    this.editing.cancelEdit(this.id);
  }
}
