'use client';
import * as React from 'react';
import * as Primitive from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/cn';
export interface ScrollAreaProps extends React.ComponentPropsWithoutRef<
  typeof Primitive.Root
> {
  viewportProps?: React.ComponentPropsWithoutRef<typeof Primitive.Viewport>;
  orientation?: 'vertical' | 'horizontal' | 'both';
}
export const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof Primitive.Root>,
  ScrollAreaProps
>(function ScrollArea(
  {
    className,
    children,
    viewportProps,
    orientation = 'vertical',
    type = 'hover',
    ...props
  },
  ref,
) {
  return (
    <Primitive.Root
      ref={ref}
      type={type}
      className={cn('ui-scroll-area', className)}
      {...props}
    >
      <Primitive.Viewport
        {...viewportProps}
        tabIndex={viewportProps?.tabIndex ?? 0}
        className={cn('ui-scroll-viewport', viewportProps?.className)}
      >
        {children}
      </Primitive.Viewport>
      {(orientation === 'vertical' || orientation === 'both') && (
        <Primitive.Scrollbar orientation="vertical" className="ui-scrollbar">
          <Primitive.Thumb className="ui-scroll-thumb" />
        </Primitive.Scrollbar>
      )}
      {(orientation === 'horizontal' || orientation === 'both') && (
        <Primitive.Scrollbar orientation="horizontal" className="ui-scrollbar">
          <Primitive.Thumb className="ui-scroll-thumb" />
        </Primitive.Scrollbar>
      )}
      <Primitive.Corner />
    </Primitive.Root>
  );
});
