'use client';
import * as React from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import '@/styles/warmup.css';
const variants = {
  upload: {
    title: 'some files didn’t upload',
    body: 'check your connection and try again. nothing you made is lost.',
    primary: 'retry uploads',
    secondary: 'back',
  },
  session: {
    title: 'kimo couldn’t start this edit',
    body: 'the editor hit a problem before it began. your files are saved for 24 hours.',
    primary: 'try again',
    secondary: 'start over',
  },
} as const;
export function FullScreenError({
  variant = 'session',
  detail,
  onRetry,
  onBack,
}: {
  variant?: keyof typeof variants;
  detail?: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  const copy = variants[variant];
  return (
    <main className="session-error-screen" data-ready="true">
      <section>
        <CircleAlert className="session-error-icon" aria-hidden="true" />
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        {detail && <p className="session-error-detail">{detail}</p>}
        <div className="session-error-actions">
          <Button variant="primary" onClick={onRetry}>
            {copy.primary}
          </Button>
          <Button variant="secondary" onClick={onBack}>
            {copy.secondary}
          </Button>
        </div>
      </section>
    </main>
  );
}
