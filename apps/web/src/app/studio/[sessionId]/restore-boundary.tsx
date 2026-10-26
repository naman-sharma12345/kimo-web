'use client';
import * as React from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SessionSnapshot } from '@kimo/client';
import { useProject } from '@/stores/project';
import { useSession } from '@/stores/session';
import { restoreUploadSession } from '@/lib/uploads';
import { AttachmentChip } from '@/components/ui/attachment-chip';
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
/** Phase 3 restore boundary only. Deliberately not a Phase 5 editor. */
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
    <main className="studio-restore-boundary" data-ready="true">
      <section>
        <h1>studio integration boundary</h1>
        <p>
          this session is restored. the editing interface is not implemented in
          this build.
        </p>
        <p className="mono">
          session {sessionId} · project version {snapshot.project.version}
        </p>
        {prompt && (
          <section
            className="studio-original-message"
            aria-label="original request"
          >
            <h2>your request</h2>
            <p>{prompt}</p>
          </section>
        )}
        {!!snapshot.assets.length && (
          <div
            className="studio-restored-assets"
            aria-label="session attachments"
          >
            {snapshot.assets.map((asset) => (
              <AttachmentChip
                key={asset.id}
                name={asset.name}
                meta={asset.kind}
                kind={asset.kind}
                thumbnail={
                  asset.thumbUrl ??
                  (asset.kind === 'image' ? asset.url : undefined)
                }
              />
            ))}
          </div>
        )}
        <Link href="/" className="ui-button ui-button-secondary" data-size="md">
          <span className="ui-button-label">start a new video</span>
        </Link>
      </section>
    </main>
  );
}
