'use client';
import * as React from 'react';
import * as Primitive from '@radix-ui/react-context-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
export const ContextMenu = Primitive.Root;
export const ContextMenuTrigger = React.forwardRef<
  React.ComponentRef<typeof Primitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof Primitive.Trigger>
>(function ContextMenuTrigger(
  { onKeyDown, asChild, disabled, tabIndex, ...props },
  ref,
) {
  return (
    <Primitive.Trigger
      ref={ref}
      asChild={asChild}
      disabled={disabled}
      tabIndex={disabled ? -1 : (tabIndex ?? (asChild ? undefined : 0))}
      {...props}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          !disabled &&
          !event.defaultPrevented &&
          (event.key === 'ContextMenu' ||
            (event.shiftKey && event.key === 'F10'))
        ) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          event.currentTarget.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              clientX: rect.left,
              clientY: rect.bottom,
            }),
          );
        }
      }}
    />
  );
});
export const ContextMenuGroup = Primitive.Group;
export const ContextMenuRadioGroup = Primitive.RadioGroup;
export const ContextMenuSub = Primitive.Sub;
export const ContextMenuContent = React.forwardRef<
  React.ComponentRef<typeof Primitive.Content>,
  React.ComponentPropsWithoutRef<typeof Primitive.Content>
>(function ContextMenuContent({ className, ...props }, ref) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        ref={ref}
        className={cn('ui-menu', className)}
        {...props}
      />
    </Primitive.Portal>
  );
});
export const ContextMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof Primitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof Primitive.SubContent>
>(function ContextMenuSubContent({ className, ...props }, ref) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent
        ref={ref}
        className={cn('ui-menu', className)}
        {...props}
      />
    </Primitive.Portal>
  );
});
export const ContextMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof Primitive.Separator>,
  React.ComponentPropsWithoutRef<typeof Primitive.Separator>
>(function ContextMenuSeparator({ className, ...props }, ref) {
  return (
    <Primitive.Separator
      ref={ref}
      className={cn('ui-menu-separator', className)}
      {...props}
    />
  );
});
export const ContextMenuLabel = React.forwardRef<
  React.ComponentRef<typeof Primitive.Label>,
  React.ComponentPropsWithoutRef<typeof Primitive.Label>
>(function ContextMenuLabel({ className, ...props }, ref) {
  return (
    <Primitive.Label
      ref={ref}
      className={cn('ui-menu-label', className)}
      {...props}
    />
  );
});
export const ContextMenuItem = React.forwardRef<
  React.ComponentRef<typeof Primitive.Item>,
  React.ComponentPropsWithoutRef<typeof Primitive.Item> & {
    icon?: React.ReactNode;
    shortcut?: React.ReactNode;
  }
>(function ContextMenuItem(
  { className, children, icon, shortcut, ...props },
  ref,
) {
  return (
    <Primitive.Item
      ref={ref}
      className={cn('ui-menu-item', className)}
      {...props}
    >
      {icon && (
        <span className="ui-menu-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
      {shortcut && <span className="ui-menu-shortcut">{shortcut}</span>}
    </Primitive.Item>
  );
});
export const ContextMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof Primitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof Primitive.CheckboxItem> & {
    icon?: React.ReactNode;
    shortcut?: React.ReactNode;
  }
>(function ContextMenuCheckboxItem(
  { className, children, icon, shortcut, ...props },
  ref,
) {
  return (
    <Primitive.CheckboxItem
      ref={ref}
      className={cn('ui-menu-item', className)}
      {...props}
    >
      <Primitive.ItemIndicator className="ui-menu-check">
        <Check />
      </Primitive.ItemIndicator>
      {icon && (
        <span className="ui-menu-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
      {shortcut && <span className="ui-menu-shortcut">{shortcut}</span>}
    </Primitive.CheckboxItem>
  );
});
export const ContextMenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof Primitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof Primitive.RadioItem> & {
    icon?: React.ReactNode;
    shortcut?: React.ReactNode;
  }
>(function ContextMenuRadioItem(
  { className, children, icon, shortcut, ...props },
  ref,
) {
  return (
    <Primitive.RadioItem
      ref={ref}
      className={cn('ui-menu-item', className)}
      {...props}
    >
      <Primitive.ItemIndicator className="ui-menu-check">
        <Check />
      </Primitive.ItemIndicator>
      {icon && (
        <span className="ui-menu-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
      {shortcut && <span className="ui-menu-shortcut">{shortcut}</span>}
    </Primitive.RadioItem>
  );
});
export const ContextMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof Primitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof Primitive.SubTrigger> & {
    icon?: React.ReactNode;
    shortcut?: React.ReactNode;
  }
>(function ContextMenuSubTrigger(
  { className, children, icon, shortcut, ...props },
  ref,
) {
  return (
    <Primitive.SubTrigger
      ref={ref}
      className={cn('ui-menu-item', className)}
      {...props}
    >
      {icon && (
        <span className="ui-menu-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
      {shortcut && <span className="ui-menu-shortcut">{shortcut}</span>}
      <ChevronRight className="ui-menu-sub-arrow" aria-hidden="true" />
    </Primitive.SubTrigger>
  );
});
