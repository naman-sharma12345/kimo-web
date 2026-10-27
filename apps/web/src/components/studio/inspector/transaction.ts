import type { KimoProject, Op } from '@kimo/client';
import type { EditingAPI } from '@/lib/editing/types';
/** UI-local transaction lifecycle, delegates all projection/history/network to EditingAPI. */
export class FieldTransaction {
  private id: string | undefined;
  private baseline: KimoProject | undefined;
  private ops: readonly Op[] = [];
  constructor(
    private editing: EditingAPI,
    private clipIds: readonly string[],
    private label: string,
  ) {}
  begin() {
    if (this.id) return;
    this.baseline = this.editing.getState().project;
    this.id = this.editing.beginEdit({
      clipIds: this.clipIds,
      label: this.label,
      source: 'inspector',
    });
  }
  preview(build: (project: KimoProject) => readonly Op[]) {
    this.begin();
    if (!this.baseline || !this.id) return;
    this.ops = build(this.baseline);
    this.editing.previewEdit(this.id, this.ops);
  }
  commit() {
    const id = this.id,
      ops = this.ops;
    this.id = undefined;
    this.baseline = undefined;
    this.ops = [];
    if (id) {
      if (!ops.length) {
        this.editing.cancelEdit(id);
        return;
      }
      return this.editing.commitEdit(id, ops);
    }
  }
  cancel() {
    if (this.id) this.editing.cancelEdit(this.id);
    this.id = undefined;
    this.baseline = undefined;
    this.ops = [];
  }
}
