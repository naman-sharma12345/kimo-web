'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { attachUploadBrowserEvents } from '@/lib/uploads';
import '@/styles/ui.css';

function UploadBrowserEvents({ children }: { children: React.ReactNode }) {
  const { notify } = useToast();
  useEffect(
    () =>
      attachUploadBrowserEvents((message) => {
        notify({ message, tone: 'error' });
      }),
    [notify],
  );
  return children;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <UploadBrowserEvents>{children}</UploadBrowserEvents>
      </ToastProvider>
    </QueryClientProvider>
  );
}
