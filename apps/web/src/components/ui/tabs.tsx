'use client';
import * as React from 'react';
import * as Primitive from '@radix-ui/react-tabs';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';
import { durations, spring } from '@/lib/motion';
const Selection = React.createContext({ value: '', id: '' });
export const Tabs = React.forwardRef<
  React.ComponentRef<typeof Primitive.Root>,
  React.ComponentPropsWithoutRef<typeof Primitive.Root>
>(function Tabs(
  { value, defaultValue = '', onValueChange, className, children, ...props },
  ref,
) {
  const [internal, setInternal] = React.useState(defaultValue);
  const id = React.useId();
  return (
    <Selection.Provider value={{ value: value ?? internal, id }}>
      <Primitive.Root
        ref={ref}
        value={value ?? internal}
        onValueChange={(next) => {
          setInternal(next);
          onValueChange?.(next);
        }}
        className={cn('ui-tabs', className)}
        {...props}
      >
        {children}
      </Primitive.Root>
    </Selection.Provider>
  );
});
export const TabsList = React.forwardRef<
  React.ComponentRef<typeof Primitive.List>,
  React.ComponentPropsWithoutRef<typeof Primitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <Primitive.List
      ref={ref}
      className={cn('ui-tabs-list', className)}
      {...props}
    />
  );
});
export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof Primitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof Primitive.Trigger>
>(function TabsTrigger({ value, className, children, ...props }, ref) {
  const selected = React.useContext(Selection);
  const reduced = useReducedMotion();
  return (
    <Primitive.Trigger
      ref={ref}
      value={value}
      className={cn('ui-tabs-trigger', className)}
      {...props}
    >
      {children}
      {selected.value === value && (
        <motion.span
          aria-hidden="true"
          className="ui-tabs-indicator"
          layoutId={reduced ? undefined : `${selected.id}-underline`}
          initial={reduced ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={reduced ? { duration: durations.d2 } : spring.snappy}
        />
      )}
    </Primitive.Trigger>
  );
});
export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof Primitive.Content>,
  React.ComponentPropsWithoutRef<typeof Primitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <Primitive.Content
      ref={ref}
      className={cn('ui-tabs-content', className)}
      {...props}
    />
  );
});
