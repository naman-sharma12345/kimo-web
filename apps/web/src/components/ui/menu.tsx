'use client';
import * as React from 'react';
import * as Primitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
export const Menu = Primitive.Root;
export const MenuTrigger = Primitive.Trigger;
export const MenuGroup = Primitive.Group;
export const MenuRadioGroup = Primitive.RadioGroup;
export const MenuSub = Primitive.Sub;
export const MenuContent = React.forwardRef<
  React.ComponentRef<typeof Primitive.Content>,
  React.ComponentPropsWithoutRef<typeof Primitive.Content>
>(function MenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn('ui-menu', className)}
        {...props}
      />
    </Primitive.Portal>
  );
});
export const MenuSubContent = React.forwardRef<
  React.ComponentRef<typeof Primitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof Primitive.SubContent>
>(function MenuSubContent({ className, ...props }, ref) {
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
export const MenuSeparator = React.forwardRef<
  React.ComponentRef<typeof Primitive.Separator>,
  React.ComponentPropsWithoutRef<typeof Primitive.Separator>
>(function MenuSeparator({ className, ...props }, ref) {
  return (
    <Primitive.Separator
      ref={ref}
      className={cn('ui-menu-separator', className)}
      {...props}
    />
  );
});
export const MenuLabel = React.forwardRef<
  React.ComponentRef<typeof Primitive.Label>,
  React.ComponentPropsWithoutRef<typeof Primitive.Label>
>(function MenuLabel({ className, ...props }, ref) {
  return (
    <Primitive.Label
      ref={ref}
      className={cn('ui-menu-label', className)}
      {...props}
    />
  );
});
export const MenuItem = React.forwardRef<
  React.ComponentRef<typeof Primitive.Item>,
  React.ComponentPropsWithoutRef<typeof Primitive.Item> & {
    icon?: React.ReactNode;
    shortcut?: React.ReactNode;
  }
>(function MenuItem({ className, children, icon, shortcut, ...props }, ref) {
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
export const MenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof Primitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof Primitive.CheckboxItem> & {
    icon?: React.ReactNode;
    shortcut?: React.ReactNode;
  }
>(function MenuCheckboxItem(
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
export const MenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof Primitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof Primitive.RadioItem> & {
    icon?: React.ReactNode;
    shortcut?: React.ReactNode;
  }
>(function MenuRadioItem(
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
export const MenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof Primitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof Primitive.SubTrigger> & {
    icon?: React.ReactNode;
    shortcut?: React.ReactNode;
  }
>(function MenuSubTrigger(
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
