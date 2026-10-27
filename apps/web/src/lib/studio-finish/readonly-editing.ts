import {
  assetSchema,
  projectSchema,
  type Asset,
  type KimoProject,
} from '@kimo/client';
import type { EditingAPI, EditResult, EditState } from '@/lib/editing/types';

const reason = 'historical cut preview is read-only';
function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((child: unknown) => frozen(child));
    Object.freeze(value);
  }
  return value;
}
/** A presentation-only facade. It never becomes a second editing authority. */
export function createReadOnlyEditing(
  live: EditingAPI,
  project: KimoProject,
  assets: readonly Asset[],
): EditingAPI {
  const preview = frozen(projectSchema.parse(project));
  const previewAssets = frozen(assets.map((asset) => assetSchema.parse(asset)));
  const listeners = new Set<(state: EditState) => void>();
  let disposed = false;
  let source = live.getState();
  const present = (state: EditState): EditState => ({
    ...state,
    project: preview,
    assets: previewAssets,
    editingEnabled: false,
    dispatchEnabled: false,
    canUndo: false,
    canRedo: false,
    pending: [],
    draft: null,
    history: [],
    suggestions: [],
    error: reason,
  });
  let state = present(source);
  const read = () => {
    if (!disposed && source !== live.getState()) {
      source = live.getState();
      state = present(source);
    }
    return state;
  };
  const stop = live.subscribe((next) => {
    if (disposed) return;
    source = next;
    state = present(next);
    listeners.forEach((listener) => listener(state));
  });
  let close!: () => void;
  const closed = new Promise<void>((resolve) => {
    close = resolve;
  });
  const reject = (): never => {
    throw new Error(reason);
  };
  const failed = async (): Promise<EditResult> => ({
    id: 'historical-readonly',
    status: 'failed',
    error: reason,
  });
  return {
    getState: read,
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async ready() {
      const status = read().persistenceStatus;
      return {
        status: status === 'hydrating' ? 'unavailable' : status,
        error: reason,
      };
    },
    closed: () => closed,
    beginEdit: reject,
    previewEdit: reject,
    commitEdit: failed,
    cancelEdit: reject,
    editGroup: failed,
    undoUser: failed,
    redoUser: failed,
    revertAgentGroup: failed,
    receiveAuthoritative: async () => reject(),
    replaceSnapshot: reject,
    resolveTextSuggestion: reject,
    async flush() {},
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      listeners.clear();
      state = {
        ...state,
        persistenceStatus: 'disposed',
        saveStatus: 'disposed',
      };
      close();
    },
  };
}
