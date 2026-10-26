'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';
export interface InputProps extends React.ComponentPropsWithoutRef<'input'> {
  error?: string;
}
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    { error, id, className, 'aria-describedby': describedBy, ...props },
    ref,
  ) {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    return (
      <div className="ui-field">
        <input
          {...props}
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={cn(describedBy, error && errorId) || undefined}
          className={cn('ui-input', className)}
        />
        {error && (
          <p id={errorId} className="ui-field-error" aria-live="polite">
            {error}
          </p>
        )}
      </div>
    );
  },
);
