import * as React from 'react';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createServerApi } from '@/lib/server-api';
import { deliveryMetadata } from '@/lib/delivery/metadata';
import { routeFailure } from '@/lib/render/lifecycle';
import { RouteState } from '@/components/render/route-state';
import { DeliveryScreen } from '@/components/delivery/delivery-screen';
export const dynamic = 'force-dynamic';
const load = cache((id: string) =>
  createServerApi()
    .then((api) => api.video(id))
    .then(
      (video) => ({ video }),
      (error) => ({ error: routeFailure(error) }),
    ),
);
export async function generateMetadata({
  params,
}: {
  params: Promise<{ videoId: string }>;
}): Promise<Metadata> {
  const result = await load((await params).videoId);
  return 'video' in result
    ? deliveryMetadata(result.video)
    : {
        title: 'video unavailable | kimo',
        robots: { index: false, follow: false },
      };
}
export default async function VideoPage({
  params,
}: {
  params: Promise<{ videoId: string }>;
}) {
  const { videoId } = await params;
  const result = await load(videoId);
  if ('error' in result) {
    if (result.error === 'missing') notFound();
    return <RouteState kind={result.error} />;
  }
  return <DeliveryScreen videoId={videoId} video={result.video} />;
}
