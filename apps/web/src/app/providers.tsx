'use client';
import * as React from 'react';
import { usePathname } from 'next/navigation';
import { RouteFocus } from '@/components/navigation/route-focus';
type Interactive = React.ComponentType<{ children: React.ReactNode }>;
export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const publicPage = pathname === '/' || pathname === '/privacy';
  const [Interactive, setInteractive] = React.useState<Interactive | null>(
    null,
  );
  const [failed, setFailed] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    if (publicPage || Interactive) return;
    let active = true;
    setFailed(false);
    void import('./interactive-providers')
      .then((module) => {
        if (active) setInteractive(() => module.InteractiveProviders);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [publicPage, Interactive, retry]);
  // Landing loads its own interactive context only after a real gesture.
  if (publicPage)
    return (
      <>
        <RouteFocus />
        {children}
      </>
    );
  if (!Interactive)
    return (
      <main
        className="dev-page"
        aria-busy={!failed}
        data-provider-state={failed ? 'error' : 'loading'}
      >
        <h1 tabIndex={-1} data-route-focus>
          {failed ? 'the interface couldn’t load' : 'restoring the interface…'}
        </h1>
        {failed ? (
          <>
            <p>
              your session has not been changed. try loading the interface
              again.
            </p>
            <button onClick={() => setRetry((value) => value + 1)}>
              try again
            </button>
          </>
        ) : (
          <p role="status">loading editing controls</p>
        )}
      </main>
    );
  return (
    <Interactive>
      <RouteFocus />
      {children}
    </Interactive>
  );
}
