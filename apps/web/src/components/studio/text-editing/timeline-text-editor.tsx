'use client';
import * as React from 'react';
import { TextField } from './text-field';
import type { TimelineTextEditorProps } from './types';
export function TimelineTextEditor({
  autoFocus = true,
  selectAll = true,
  ...props
}: TimelineTextEditorProps) {
  return (
    <TextField
      {...props}
      {...{ autoFocus }}
      selectAll={selectAll}
      source="timeline"
      inline
    />
  );
}
