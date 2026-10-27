import type { Clip } from '@kimo/client';
import type { EditingAPI, EditSource, EditState } from '@/lib/editing/types';
import { textUpdate } from '@/lib/editing/text';

export const PREVIEW_DELAY = 150;
export const IDLE_DELAY = 800;
export interface TextValue {
  content: string;
  secondaryContent: string;
  active: boolean;
  removed: boolean;
  error?: string;
}
/** One uncommitted value per clip/authority, shared by every mounted surface. */
export class TextEditModel {
  private value: TextValue;
  private listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  private transaction: string | null = null;
  private baseline: Clip | undefined;
  private dirty = false;
  private composing = false;
  private previewTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private source: EditSource = 'inspector';
  constructor(
    readonly editing: EditingAPI,
    readonly clipId: string,
  ) {
    const clip = editing.getState().project.clips[clipId];
    this.value = {
      content: clip?.text?.content ?? '',
      secondaryContent: clip?.text?.secondaryContent ?? '',
      active: false,
      removed: !clip,
    };
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.unsubscribe)
      this.unsubscribe = this.editing.subscribe(this.receive);
    this.receive(this.editing.getState());
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.cancel();
      }
    };
  };
  private emit(value: TextValue) {
    this.value = value;
    this.listeners.forEach((listener) => listener());
  }
  private receive = (state: EditState) => {
    const clip = state.project.clips[this.clipId];
    if (!clip || state.saveStatus === 'disposed') {
      this.clearTimers();
      this.generation++;
      this.transaction = null;
      if (!this.value.removed)
        this.emit({ ...this.value, active: false, removed: true });
      return;
    }
    if (this.transaction && state.draft?.id !== this.transaction) {
      // Another authority action cancelled/replaced the session. Never revive stale timers.
      this.clearTimers();
      this.generation++;
      this.transaction = null;
      this.dirty = false;
    }
    if (!this.transaction) {
      const content = clip.text?.content ?? '';
      const secondaryContent = clip.text?.secondaryContent ?? '';
      if (
        content !== this.value.content ||
        secondaryContent !== this.value.secondaryContent ||
        this.value.active ||
        this.value.removed
      )
        this.emit({ content, secondaryContent, active: false, removed: false });
    }
  };
  start(source: EditSource) {
    if (this.transaction || this.value.removed) return;
    const state = this.editing.getState();
    const clip = state.project.clips[this.clipId];
    if (!clip?.text || clip.locked || state.saveStatus === 'disposed') return;
    this.source = source;
    this.baseline = structuredClone(clip);
    try {
      // beginEdit emits synchronously, before its returned id can be assigned.
      this.transaction = this.editing.beginEdit({
        clipIds: [this.clipId],
        label: 'you changed the title text',
        source,
      });
      this.emit({ ...this.value, active: true, error: undefined });
    } catch (error) {
      this.emit({
        ...this.value,
        error: error instanceof Error ? error.message : 'text edit unavailable',
      });
    }
  }
  change(
    field: 'content' | 'secondaryContent',
    text: string,
    source: EditSource,
  ) {
    this.start(source);
    if (!this.transaction) return;
    this.dirty = true;
    this.emit({ ...this.value, [field]: text });
    this.clearTimers();
    if (!this.composing) this.schedule();
  }
  composition(active: boolean) {
    this.composing = active;
    this.clearTimers();
    if (!active && this.dirty) this.schedule();
  }
  private schedule() {
    const generation = this.generation;
    this.previewTimer = setTimeout(() => {
      if (generation === this.generation) this.preview();
    }, PREVIEW_DELAY);
    this.idleTimer = setTimeout(() => {
      if (generation === this.generation) this.commit(true);
    }, IDLE_DELAY);
  }
  private operation() {
    return this.baseline
      ? textUpdate(
          this.baseline,
          this.value.content,
          this.value.secondaryContent,
        )
      : undefined;
  }
  preview() {
    if (!this.transaction || !this.dirty || this.composing) return;
    const op = this.operation();
    if (!op) return;
    try {
      this.editing.previewEdit(this.transaction, [op]);
    } catch (error) {
      this.fail(error);
    }
  }
  commit(keepFocused = false) {
    if (this.composing) return;
    if (
      keepFocused &&
      this.editing
        .getState()
        .suggestions.some((suggestion) => suggestion.clipId === this.clipId)
    ) {
      // A pending AI suggestion is a decision, not permission to auto-save over it.
      this.clearTimers();
      return;
    }
    this.clearTimers();
    this.generation++;
    const id = this.transaction;
    if (!id) return;
    const op = this.operation();
    const dirty = this.dirty;
    this.transaction = null;
    this.dirty = false;
    if (dirty && op) {
      const generation = this.generation;
      void this.editing
        .commitEdit(id, [op])
        .then((result) => {
          if (generation === this.generation && result.status === 'failed')
            this.emit({
              ...this.value,
              error: result.error ?? 'text edit could not be saved',
            });
        })
        .catch((error: unknown) => {
          if (generation === this.generation) this.fail(error);
        });
    } else this.editing.cancelEdit(id);
    this.receive(this.editing.getState());
    if (keepFocused && !this.value.removed) this.start(this.source);
  }
  cancel() {
    this.clearTimers();
    this.generation++;
    this.composing = false;
    const id = this.transaction;
    this.transaction = null;
    this.dirty = false;
    if (id) this.editing.cancelEdit(id);
    this.receive(this.editing.getState());
  }
  resolve(choice: 'use it' | 'keep mine') {
    this.clearTimers();
    // Ensure keep mine includes even keystrokes not yet debounced to projection.
    this.preview();
    this.editing.resolveTextSuggestion(this.clipId, choice);
    const clip = this.editing.getState().project.clips[this.clipId];
    if (clip?.text) {
      this.dirty = true;
      this.emit({
        ...this.value,
        content: clip.text.content,
        secondaryContent: clip.text.secondaryContent ?? '',
      });
      if (!this.composing) this.schedule();
    }
  }
  private fail(error: unknown) {
    this.clearTimers();
    this.emit({
      ...this.value,
      error: error instanceof Error ? error.message : 'text edit unavailable',
    });
  }
  private clearTimers() {
    clearTimeout(this.previewTimer);
    clearTimeout(this.idleTimer);
  }
}
const models = new WeakMap<EditingAPI, Map<string, TextEditModel>>();
export function getTextEditModel(editing: EditingAPI, clipId: string) {
  let byClip = models.get(editing);
  if (!byClip) {
    byClip = new Map();
    models.set(editing, byClip);
  }
  let model = byClip.get(clipId);
  if (!model) {
    model = new TextEditModel(editing, clipId);
    byClip.set(clipId, model);
  }
  return model;
}
