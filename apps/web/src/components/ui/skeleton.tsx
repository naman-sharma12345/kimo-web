import * as React from 'react';
import { cn } from '@/lib/cn';
export interface SkeletonProps extends React.ComponentPropsWithoutRef<'div'> {
  radius?: '4' | '6' | '8' | '12' | '20' | 'pill';
}
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  function Skeleton({ radius = '8', className, ...props }, ref) {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        data-radius={radius}
        className={cn('ui-skeleton', className)}
        {...props}
      />
    );
  },
);
