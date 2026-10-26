'use client';
import * as React from 'react';
import { cn } from '@/lib/cn';
export interface TextareaProps extends React.ComponentPropsWithoutRef<'textarea'> {
  error?: string;
  maxRows?: number;
}
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      error,
      maxRows = 8,
      id,
      className,
      'aria-describedby': describedBy,
      onChange,
      value,
      ...props
    },
    forwardedRef,
  ) {
    const ref = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(forwardedRef, () => {
      const node = ref.current;
      if (!node) throw new Error('Textarea ref is not mounted');
      return node;
    });
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const resize = React.useCallback(() => {
      const node = ref.current;
      if (!node) return;
      const style = getComputedStyle(node);
      const line = Number.parseFloat(style.lineHeight);
      const padding =
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);
      const border =
        Number.parseFloat(style.borderTopWidth) +
        Number.parseFloat(style.borderBottomWidth);
      if (!Number.isFinite(line)) return;
      node.style.height = 'auto';
      const limit = line * Math.max(1, maxRows) + padding + border;
      node.style.height = `${Math.min(node.scrollHeight + border, limit)}px`;
      node.style.overflowY =
        node.scrollHeight + border > limit ? 'auto' : 'hidden';
    }, [maxRows]);
    React.useLayoutEffect(resize, [resize, value]);
    React.useEffect(() => {
      const node = ref.current;
      if (!node || typeof ResizeObserver === 'undefined') return;
      let width = node.clientWidth;
      const observer = new ResizeObserver(() => {
        if (node.clientWidth !== width) {
          width = node.clientWidth;
          resize();
        }
      });
      observer.observe(node);
      return () => observer.disconnect();
    }, [resize]);
    return (
      <div className="ui-field">
        <textarea
          {...props}
          value={value}
          rows={1}
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={cn(describedBy, error && errorId) || undefined}
          className={cn('ui-input ui-textarea', className)}
          onChange={(event) => {
            resize();
            onChange?.(event);
          }}
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
