'use client';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionSnapshot } from '@kimo/client';
import { useProject } from '@/stores/project';
import { useSession } from '@/stores/session';
import { restoreUploadSession } from '@/lib/uploads';
import { StudioShell } from '@/components/studio/studio-shell';
import { FullScreenError } from '@/components/warmup/full-screen-error';
import '@/styles/ui.css';
import '@/styles/warmup.css';
export function SessionRestoreError({ detail }: { detail?: string }) {
  const router = useRouter();
  return (
    <FullScreenError
      variant="session"
      detail={detail}
      onRetry={() => router.refresh()}
      onBack={() => router.replace('/')}
    />
  );
}
/** Preserve the REST/session-draft restoration contract around the Phase 5 shell. */
export function StudioRestoreBoundary({
  sessionId,
  snapshot,
}: {
  sessionId: string;
  snapshot: SessionSnapshot;
}) {
  const [prompt, setPrompt] = useState('');
  useEffect(() => {
    useProject.getState().replace(snapshot.project);
    const draft =
      useSession.getState().draft ?? useSession.getState().restore();
    const uploads = restoreUploadSession();
    const original =
      draft?.sessionId === sessionId
        ? draft
        : uploads?.sessionId === sessionId
          ? uploads
          : null;
    if (original) {
      setPrompt(original.prompt);
      useSession.setState({ draft: original });
    }
  }, [snapshot, sessionId]);
  return (
    <StudioShell
      sessionId={sessionId}
      snapshot={snapshot}
      originalPrompt={prompt}
    />
  );
}
