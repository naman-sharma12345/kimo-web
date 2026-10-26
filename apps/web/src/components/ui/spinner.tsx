import * as React from 'react';
import { cn } from '@/lib/cn';
export interface SpinnerProps extends React.ComponentPropsWithoutRef<'svg'> {
  size?: 14 | 20;
  label?: string;
}
export const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  function Spinner({ size = 14, label, className, ...props }, ref) {
    return (
      <svg
        ref={ref}
        viewBox="0 0 20 20"
        className={cn('ui-spinner', className)}
        data-size={size}
        role={label ? 'status' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        {...props}
      >
        <circle className="ui-spinner-track" cx="10" cy="10" r="8" />
        <circle
          className="ui-spinner-arc"
          cx="10"
          cy="10"
          r="8"
          pathLength="360"
          strokeDasharray="90 270"
        />
      </svg>
    );
  },
);
