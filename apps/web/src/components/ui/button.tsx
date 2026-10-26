'use client';
import * as React from 'react';
import { cn, variants } from '@/lib/cn';
import { Spinner } from './spinner';
import { Tooltip } from './tooltip';
type ButtonBase = React.ComponentPropsWithoutRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
};
export type ButtonProps = ButtonBase &
  (
    | { iconOnly: true; 'aria-label': string; tooltip: string }
    | { iconOnly?: false; tooltip?: string }
  );
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'secondary',
      size = 'md',
      loading = false,
      disabled,
      iconOnly,
      tooltip,
      className,
      children,
      type = 'button',
      ...props
    },
    ref,
  ) {
    const button = (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-size={size}
        data-icon-only={iconOnly || undefined}
        data-loading={loading || undefined}
        className={cn(
          variants(
            'ui-button',
            {
              primary: 'ui-button-primary',
              secondary: 'ui-button-secondary',
              ghost: 'ui-button-ghost',
              danger: 'ui-button-danger',
            },
            variant,
          ),
          className,
        )}
        {...props}
      >
        <span className="ui-button-label">{children}</span>
        {loading && (
          <span className="ui-button-spinner">
            <Spinner />
          </span>
        )}
      </button>
    );
    return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
  },
);
