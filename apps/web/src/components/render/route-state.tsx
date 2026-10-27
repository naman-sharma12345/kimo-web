'use client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { RouteFailure } from '@/lib/render/lifecycle';
import styles from './render.module.css';
export function RouteState({ kind }: { kind: RouteFailure }) {
  const router = useRouter();
  return (
    <main className={styles.scene}>
      <section className={styles.content}>
        <h1>
          {kind === 'expired'
            ? 'this link has expired'
            : kind === 'missing'
              ? 'this link was not found'
              : 'unable to load this link'}
        </h1>
        <p>
          {kind === 'unavailable'
            ? 'the service is unavailable. this does not mean the video or session was deleted.'
            : kind === 'expired'
              ? 'the server reports that this link is no longer available.'
              : 'the server could not find this record.'}
        </p>
        {kind === 'unavailable' && (
          <Button onClick={() => router.refresh()}>try again</Button>
        )}
        <a href="/">make another</a>
      </section>
    </main>
  );
}
