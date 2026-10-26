'use client';
import * as React from 'react';
import * as Primitive from '@radix-ui/react-slider';
import { cn } from '@/lib/cn';
export interface SliderProps extends React.ComponentPropsWithoutRef<
  typeof Primitive.Root
> {
  'aria-label': string;
  formatValue?: (value: number) => string;
}
export const Slider = React.forwardRef<
  React.ComponentRef<typeof Primitive.Root>,
  SliderProps
>(function Slider(
  {
    value,
    min = 0,
    defaultValue = [min],
    onValueChange,
    className,
    formatValue = String,
    'aria-label': label,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onFocus,
    onBlur,
    ...props
  },
  ref,
) {
  const [internal, setInternal] = React.useState(defaultValue);
  const [dragging, setDragging] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const values = value ?? internal;
  React.useEffect(() => {
    const stop = () => setDragging(false);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);
  return (
    <Primitive.Root
      ref={ref}
      min={min}
      value={values}
      onValueChange={(next) => {
        setInternal(next);
        onValueChange?.(next);
      }}
      className={cn('ui-slider', className)}
      onPointerDown={(event) => {
        setDragging(true);
        onPointerDown?.(event);
      }}
      onPointerUp={(event) => {
        setDragging(false);
        onPointerUp?.(event);
      }}
      onPointerCancel={(event) => {
        setDragging(false);
        onPointerCancel?.(event);
      }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
        onBlur?.(event);
      }}
      {...props}
    >
      <Primitive.Track className="ui-slider-track">
        <Primitive.Range className="ui-slider-range" />
      </Primitive.Track>
      {values.map((current, index) => (
        <Primitive.Thumb
          key={index}
          className="ui-slider-thumb"
          aria-label={values.length === 1 ? label : `${label} ${index + 1}`}
          aria-valuetext={formatValue(current)}
        >
          {(dragging || focused) && (
            <span className="ui-slider-bubble" aria-hidden="true">
              {formatValue(current)}
            </span>
          )}
        </Primitive.Thumb>
      ))}
    </Primitive.Root>
  );
});
