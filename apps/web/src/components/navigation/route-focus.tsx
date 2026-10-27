'use client';
import * as React from 'react';
import { usePathname } from 'next/navigation';
/** Focus each new route once, never on streamed updates or reconnects. */
export function RouteFocus() {
  const pathname = usePathname();
  React.useEffect(() => {
    let complete = false;
    const focus = () => {
      if (complete || document.querySelector('[role="dialog"]')) return false;
      const target =
        document.querySelector<HTMLElement>('[data-route-focus]') ??
        document.querySelector<HTMLElement>('main h1') ??
        document.querySelector<HTMLElement>(
          'main textarea[aria-label="describe your video"]',
        ) ??
        document.querySelector<HTMLElement>('main');
      if (!target) return false;
      if (!target.matches('input, textarea, button, a, [tabindex]'))
        target.tabIndex = -1;
      target.focus({ preventScroll: true });
      complete = true;
      return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeout = setTimeout(() => observer.disconnect(), 5000);
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, [pathname]);
  return null;
}
