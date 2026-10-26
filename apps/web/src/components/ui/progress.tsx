import * as React from 'react';
import { cn } from '@/lib/cn';
export interface ProgressProps extends Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'children'
> {
  value?: number;
  thin?: boolean;
  running?: boolean;
  'aria-label': string;
}
export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  function Progress(
    { value, thin = false, running = false, className, ...props },
    ref,
  ) {
    const bounded =
      value === undefined ? undefined : Math.min(100, Math.max(0, value));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bounded}
        data-thin={thin || undefined}
        data-running={running || undefined}
        data-indeterminate={bounded === undefined || undefined}
        className={cn('ui-progress', className)}
        {...props}
      >
        <span
          className="ui-progress-fill"
          style={bounded === undefined ? undefined : { width: `${bounded}%` }}
        />
      </div>
    );
  },
);
