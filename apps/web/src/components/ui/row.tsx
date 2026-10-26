import * as React from 'react';
import { cn } from '@/lib/cn';
export interface RowProps extends Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'children'
> {
  label: React.ReactNode;
  value: React.ReactNode;
  dense?: boolean;
}
export const Row = React.forwardRef<HTMLDivElement, RowProps>(function Row(
  { label, value, dense = false, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('ui-row', className)}
      data-dense={dense || undefined}
      {...props}
    >
      <span className="ui-row-label">{label}</span>
      <span className="ui-row-value">{value}</span>
    </div>
  );
});
