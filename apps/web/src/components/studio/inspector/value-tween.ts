'use client';
import * as React from 'react';
import { animate } from 'motion';
import { useReducedMotion } from 'motion/react';
import { durations, easings } from '@/lib/motion';
/** Readout-only tween. Never writes project state, edits, transport or animation keys. */
export function useValueTween(value: number, active: boolean): number {
  const reduced = useReducedMotion();
  const [display, setDisplay] = React.useState(value);
  const previous = React.useRef(value);
  React.useEffect(() => {
    if (!active || reduced) {
      previous.current = value;
      setDisplay(value);
      return;
    }
    const control = animate(previous.current, value, {
      duration: durations.d2,
      ease: easings.out,
      onUpdate: (next) => {
        previous.current = next;
        setDisplay(next);
      },
    });
    return () => control.stop();
  }, [value, active, reduced]);
  return active && !reduced ? display : value;
}
