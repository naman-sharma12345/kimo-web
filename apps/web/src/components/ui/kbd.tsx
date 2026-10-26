import * as React from 'react';
import { cn } from '@/lib/cn';
export const Kbd = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<'kbd'>
>(function Kbd({ className, ...props }, ref) {
  return <kbd ref={ref} className={cn('ui-kbd', className)} {...props} />;
});
