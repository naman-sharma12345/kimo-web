'use client';
import * as React from 'react';
import * as Primitive from '@radix-ui/react-toggle-group';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';
import { durations, spring } from '@/lib/motion';
const Selection = React.createContext({ value: '', id: '' });
export interface SegmentedProps extends Omit<
  React.ComponentPropsWithoutRef<typeof Primitive.Root>,
  'type' | 'value' | 'defaultValue' | 'onValueChange'
> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}
export const Segmented = React.forwardRef<
  React.ComponentRef<typeof Primitive.Root>,
  SegmentedProps
>(function Segmented(
  { value, defaultValue = '', onValueChange, className, children, ...props },
  ref,
) {
  const [internal, setInternal] = React.useState(defaultValue);
  const id = React.useId();
  const selected = value ?? internal;
  return (
    <Selection.Provider value={{ value: selected, id }}>
      <Primitive.Root
        ref={ref}
        type="single"
        value={selected}
        onValueChange={(next) => {
          if (!next) return;
          setInternal(next);
          onValueChange?.(next);
        }}
        className={cn('ui-segmented', className)}
        {...props}
      >
        {children}
      </Primitive.Root>
    </Selection.Provider>
  );
});
export const SegmentedItem = React.forwardRef<
  React.ComponentRef<typeof Primitive.Item>,
  React.ComponentPropsWithoutRef<typeof Primitive.Item>
>(function SegmentedItem({ className, children, value, ...props }, ref) {
  const selected = React.useContext(Selection);
  const reduced = useReducedMotion();
  return (
    <Primitive.Item
      ref={ref}
      value={value}
      className={cn('ui-segmented-item', className)}
      {...props}
    >
      {selected.value === value && (
        <motion.span
          aria-hidden="true"
          className="ui-segmented-indicator"
          layoutId={reduced ? undefined : `${selected.id}-selection`}
          initial={reduced ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={reduced ? { duration: durations.d2 } : spring.snappy}
        />
      )}
      <span className="ui-segmented-label">{children}</span>
    </Primitive.Item>
  );
});
