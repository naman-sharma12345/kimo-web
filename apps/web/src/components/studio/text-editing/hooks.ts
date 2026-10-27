'use client';
import { useCallback, useSyncExternalStore } from 'react';
import type { EditingAPI } from '@/lib/editing/types';
import { getTextEditModel } from './model';
export function useEditingState(editing: EditingAPI) {
  const subscribe = useCallback(
    (listener: () => void) => editing.subscribe(listener),
    [editing],
  );
  return useSyncExternalStore(subscribe, editing.getState, editing.getState);
}
export function useTextModel(editing: EditingAPI, clipId: string) {
  const model = getTextEditModel(editing, clipId);
  const value = useSyncExternalStore(
    model.subscribe,
    model.getSnapshot,
    model.getSnapshot,
  );
  return { model, value };
}
