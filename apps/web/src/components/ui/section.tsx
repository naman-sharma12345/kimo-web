'use client';
import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
export interface SectionProps extends React.ComponentPropsWithoutRef<'section'> {
  label: string;
  collapsible?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}
export const Section = React.forwardRef<HTMLElement, SectionProps>(
  function Section(
    {
      label,
      collapsible = false,
      open,
      defaultOpen = true,
      onOpenChange,
      className,
      children,
      ...props
    },
    ref,
  ) {
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
    const expanded = open ?? internalOpen;
    const id = React.useId();
    return (
      <section ref={ref} className={cn('ui-section', className)} {...props}>
        {collapsible ? (
          <h3 className="ui-section-heading">
            <button
              type="button"
              className="ui-section-label"
              aria-expanded={expanded}
              aria-controls={id}
              onClick={() => {
                setInternalOpen(!expanded);
                onOpenChange?.(!expanded);
              }}
            >
              <ChevronRight aria-hidden="true" data-open={expanded} />
              {label}
            </button>
          </h3>
        ) : (
          <h3 className="ui-section-label">{label}</h3>
        )}
        <div
          id={id}
          className="ui-section-content"
          hidden={collapsible && !expanded}
        >
          {children}
        </div>
      </section>
    );
  },
);
