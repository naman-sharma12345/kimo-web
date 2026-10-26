import * as React from 'react';
import { cn } from '@/lib/cn';
export interface PanelProps extends Omit<
  React.ComponentPropsWithoutRef<'section'>,
  'title'
> {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  flush?: boolean;
}
export const Panel = React.forwardRef<HTMLElement, PanelProps>(function Panel(
  { title, actions, flush = false, className, children, ...props },
  ref,
) {
  const titleId = React.useId();
  return (
    <section
      ref={ref}
      aria-labelledby={title ? titleId : undefined}
      className={cn('ui-panel', className)}
      {...props}
    >
      {(title || actions) && (
        <header className="ui-panel-header">
          {title && <h2 id={titleId}>{title}</h2>}
          <div className="ui-panel-actions">{actions}</div>
        </header>
      )}
      <div className="ui-panel-body" data-flush={flush || undefined}>
        {children}
      </div>
    </section>
  );
});
