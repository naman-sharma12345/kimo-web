'use client';
import * as React from 'react';
import { errorReporter } from '@/lib/diagnostics';
import { Button } from '@/components/ui/button';
export function RouteError({
  reset,
  screen,
  error,
}: {
  reset: () => void;
  error?: Error;
  screen: 'warmup' | 'studio' | 'render' | 'delivery' | 'privacy';
}) {
  React.useEffect(() => {
    errorReporter.report(error, { boundary: screen, category: 'unknown' });
  }, [error, screen]);
  return (
    <main className="privacy-page" data-ready="true">
      <h1 tabIndex={-1} data-route-focus>
        {screen} couldn’t load
      </h1>
      <p>
        the page hit a problem. try again to restore its current state. no
        request has been repeated.
      </p>
      <div className="dev-grid">
        <Button onClick={reset}>try again</Button>
        <a href="/">back to kimo</a>
      </div>
    </main>
  );
}
