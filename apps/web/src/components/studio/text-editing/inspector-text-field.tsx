'use client';
import * as React from 'react';
import { TextField } from './text-field';
import type { InspectorTextFieldProps } from './types';
export function InspectorTextField(props: InspectorTextFieldProps) {
  return <TextField {...props} />;
}
