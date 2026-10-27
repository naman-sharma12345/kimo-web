import * as React from 'react';
import { notFound, redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { RenderScreen } from '@/components/render/render-screen';
import { RouteState } from '@/components/render/route-state';
import { resolveSession, routeFailure } from '@/lib/render/lifecycle';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'rendering | kimo',
  robots: { index: false, follow: false },
};
export default async function RenderPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const result = await api.session(sessionId).then(
    (snapshot) => ({ snapshot }),
    (error) => ({ error: routeFailure(error) }),
  );
  if ('error' in result) {
    if (result.error === 'missing') notFound();
    return <RouteState kind={result.error} />;
  }
  const destination = resolveSession(result.snapshot);
  if (destination.kind === 'video')
    redirect(`/v/${encodeURIComponent(destination.videoId)}`);
  return <RenderScreen sessionId={sessionId} snapshot={result.snapshot} />;
}
