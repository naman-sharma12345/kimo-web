'use client';
import * as React from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof Primitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof Primitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <Primitive.Overlay
      ref={ref}
      className={cn('ui-dialog-overlay', className)}
      {...props}
    />
  );
});
export interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof Primitive.Content
> {
  size?: 'sm' | 'md';
}
export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof Primitive.Content>,
  DialogContentProps
>(function DialogContent({ size = 'sm', className, ...props }, ref) {
  return (
    <Primitive.Portal>
      <DialogOverlay />
      <Primitive.Content
        ref={ref}
        data-size={size}
        className={cn('ui-dialog', className)}
        {...props}
      />
    </Primitive.Portal>
  );
});
export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof Primitive.Title>,
  React.ComponentPropsWithoutRef<typeof Primitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <Primitive.Title
      ref={ref}
      className={cn('ui-dialog-title', className)}
      {...props}
    />
  );
});
export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof Primitive.Description>,
  React.ComponentPropsWithoutRef<typeof Primitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <Primitive.Description
      ref={ref}
      className={cn('ui-dialog-description', className)}
      {...props}
    />
  );
});
export const DialogActions = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(function DialogActions({ className, ...props }, ref) {
  return (
    <div ref={ref} className={cn('ui-dialog-actions', className)} {...props} />
  );
});
