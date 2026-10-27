'use client';
import * as React from 'react';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { attachUploadBrowserEvents } from '@/lib/uploads';
import '@/styles/ui.css';
function UploadBrowserEvents({ children }: { children: React.ReactNode }) {
  const { notify } = useToast();
  React.useEffect(
    () =>
      attachUploadBrowserEvents((message) =>
        notify({ message, tone: 'error' }),
      ),
    [notify],
  );
  return children;
}
/** Loaded by editing routes or a deliberate landing interaction. */
export function InteractiveProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <UploadBrowserEvents>{children}</UploadBrowserEvents>
    </ToastProvider>
  );
}
