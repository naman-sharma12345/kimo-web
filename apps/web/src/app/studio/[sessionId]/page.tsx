import * as React from 'react';
import { notFound, redirect } from 'next/navigation';
import { ApiError, type SessionSnapshot } from '@kimo/client';
import { api } from '@/lib/api';
import { sessionDestination } from '@/lib/uploads/session';
import { SessionRestoreError, StudioRestoreBoundary } from './restore-boundary';
export const dynamic = 'force-dynamic';
export default async function StudioPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  let snapshot: SessionSnapshot;
  try {
    snapshot = await api.session(sessionId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <SessionRestoreError
        detail={error instanceof Error ? error.message : undefined}
      />
    );
  }
  const destination = sessionDestination(sessionId, snapshot);
  if (destination.kind === 'redirect') redirect(destination.href);
  if (destination.kind === 'error') return <SessionRestoreError />;
  return <StudioRestoreBoundary sessionId={sessionId} snapshot={snapshot} />;
}
