'use client';
import * as React from 'react';
import type { EditingAPI } from '@/lib/editing/types';
import { useEditingState } from './hooks';
import { getTextEditModel } from './model';
import { Button } from '@/components/ui/button';
import styles from './text-editing.module.css';
export interface TextSuggestionProps {
  editing: EditingAPI;
  clipId: string;
  restoreFocusRef?: { readonly current: HTMLElement | null };
}
export function TextSuggestion({
  editing,
  clipId,
  restoreFocusRef,
}: TextSuggestionProps) {
  const state = useEditingState(editing);
  const [open, setOpen] = React.useState(false);
  const suggestion = state.suggestions.find((item) => item.clipId === clipId);
  if (!suggestion) return null;
  return (
    <div
      role="group"
      aria-label="text suggestion"
      className={styles.suggestion}
      data-text-suggestion="true"
    >
      <button
        type="button"
        onKeyDown={(event) => event.stopPropagation()}
        className={styles.hint}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        kimo wants to change this too · see suggestion
      </button>
      {open ? (
        <div role="region" aria-label="suggested text">
          <p className={styles.suggestedText}>{suggestion.content}</p>
          {(['use it', 'keep mine'] as const).map((choice) => (
            <Button
              key={choice}
              size="xs"
              onKeyDown={(event) => event.stopPropagation()}
              variant="ghost"
              onClick={() => {
                getTextEditModel(editing, clipId).resolve(choice);
                setOpen(false);
                restoreFocusRef?.current?.focus({ preventScroll: true });
              }}
            >
              {choice}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
