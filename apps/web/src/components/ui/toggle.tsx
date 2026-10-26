'use client';
import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';
import { durations, spring } from '@/lib/motion';
export interface ToggleProps extends Omit<
  React.ComponentPropsWithoutRef<'button'>,
  'onChange' | 'children'
> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  name?: string;
  value?: string;
}
export const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(
  function Toggle(
    {
      checked,
      defaultChecked = false,
      onCheckedChange,
      className,
      onClick,
      name,
      value = 'on',
      disabled,
      ...props
    },
    ref,
  ) {
    const [internal, setInternal] = React.useState(defaultChecked);
    const active = checked ?? internal;
    const reduced = useReducedMotion();
    return (
      <>
        <button
          {...props}
          ref={ref}
          type="button"
          role="switch"
          aria-checked={active}
          disabled={disabled}
          data-state={active ? 'checked' : 'unchecked'}
          className={cn('ui-toggle', className)}
          onClick={(event) => {
            onClick?.(event);
            if (!event.defaultPrevented) {
              setInternal(!active);
              onCheckedChange?.(!active);
            }
          }}
        >
          <motion.span
            aria-hidden="true"
            className="ui-toggle-knob"
            key={reduced ? String(active) : 'knob'}
            initial={reduced ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            layout={reduced ? false : 'position'}
            transition={reduced ? { duration: durations.d2 } : spring.snappy}
          />
        </button>
        {name && (
          <input
            type="hidden"
            name={name}
            value={active ? value : ''}
            disabled={disabled || !active}
          />
        )}
      </>
    );
  },
);
