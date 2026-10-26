'use client';
import * as React from 'react';
import * as Primitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';
import { Kbd } from './kbd';
import { uiTiming } from './tokens';
export function TooltipProvider({
  delayDuration = uiTiming.tooltipDelay,
  skipDelayDuration = uiTiming.tooltipSkipDelay,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Provider>) {
  return (
    <Primitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}
export function TooltipRoot({
  delayDuration = uiTiming.tooltipDelay,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Root>) {
  return <Primitive.Root delayDuration={delayDuration} {...props} />;
}
export const TooltipTrigger = Primitive.Trigger;
export const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof Primitive.Content>,
  React.ComponentPropsWithoutRef<typeof Primitive.Content> & {
    shortcut?: React.ReactNode;
  }
>(function TooltipContent(
  { className, children, shortcut, sideOffset = 6, ...props },
  ref,
) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn('ui-tooltip', className)}
        {...props}
      >
        {children}
        {shortcut && <Kbd className="ui-tooltip-kbd">{shortcut}</Kbd>}
      </Primitive.Content>
    </Primitive.Portal>
  );
});
export interface TooltipProps extends React.ComponentPropsWithoutRef<
  typeof Primitive.Root
> {
  content: React.ReactNode;
  shortcut?: React.ReactNode;
  side?: React.ComponentPropsWithoutRef<typeof Primitive.Content>['side'];
}
export function Tooltip({
  children,
  content,
  shortcut,
  side,
  delayDuration = uiTiming.tooltipDelay,
  ...props
}: TooltipProps) {
  return (
    <Primitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={uiTiming.tooltipSkipDelay}
    >
      <Primitive.Root delayDuration={delayDuration} {...props}>
        <Primitive.Trigger asChild>{children}</Primitive.Trigger>
        <TooltipContent shortcut={shortcut} side={side}>
          {content}
        </TooltipContent>
      </Primitive.Root>
    </Primitive.Provider>
  );
}
