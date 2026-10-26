import * as React from 'react';
import { cn } from '@/lib/cn';
export interface PillProps extends React.ComponentPropsWithoutRef<'span'> {
  variant?: 'default' | 'live';
  active?: boolean;
}
export const Pill = React.forwardRef<HTMLSpanElement, PillProps>(function Pill(
  { variant = 'default', active = false, className, children, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn('ui-pill', className)}
      data-variant={variant}
      data-active={active || undefined}
      {...props}
    >
      {variant === 'live' && (
        <span className="ui-pill-dot" aria-hidden="true" />
      )}
      {children}
    </span>
  );
});
