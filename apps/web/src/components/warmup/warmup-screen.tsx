'use client';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';
import type { Asset } from '@kimo/client';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { BrandMark } from '@/components/landing/brand';
import { api } from '@/lib/api';
import { useSession } from '@/stores/session';
import { useProject } from '@/stores/project';
import { attachUploadBrowserEvents, useUploads } from '@/lib/uploads';
import { WarmupReel, type ReelAsset } from './warmup-reel';
import {
  aggregateUploadProgress,
  initialWarmupState,
  warmupEvent,
  warmupSteps,
  warmupTiming,
  type WarmupStep,
} from './state';
import '@/styles/ui.css';
import '@/styles/warmup.css';
const labels: Record<WarmupStep, { active: string; done: string }> = {
  upload: { active: 'uploading your files', done: 'files uploaded' },
  watch: { active: 'watching your footage', done: 'footage watched' },
  plan: { active: 'planning the edit', done: 'plan ready' },
  ready: { active: 'opening the studio', done: 'opening the studio' },
};
const fallbacks = [
  'reading every frame…',
  'listening to the audio…',
  'looking for the best moments…',
];
export function WarmupScreen({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [state, setState] = useState(initialWarmupState);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [slow, setSlow] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [unfolding, setUnfolding] = useState(false);
  const [retry, setRetry] = useState(0);
  const [fallback, setFallback] = useState('');
  const [typed, setTyped] = useState('');
  const socket = useRef<WebSocket | undefined>(undefined);
  const localItems = useUploads((store) => store.items);
  const uploadSession = useUploads((store) => store.session);
  const items = uploadSession?.sessionId === sessionId ? localItems : [];
  const progress = items.length
    ? aggregateUploadProgress(items)
    : state.step === 'upload'
      ? state.progress
      : 1;
  const failed = items.filter((item) => item.status === 'error');
  const noticed = state.noticed || fallback;
  useEffect(() => attachUploadBrowserEvents(), []);
  const reelAssets: ReelAsset[] = items.length
    ? items.map((item) => ({
        id: item.assetId ?? item.localId,
        name: item.file.name,
        kind: item.kind,
        thumbnail: item.meta.thumbBlobUrl,
        waveform: item.meta.waveform,
      }))
    : assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        thumbnail:
          asset.thumbUrl ?? (asset.kind === 'image' ? asset.url : undefined),
      }));
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), warmupTiming.slow);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    setTyped('');
    if (!noticed) return;
    if (reduced) {
      setTyped(noticed);
      return;
    }
    let chars = 0;
    const timer = setInterval(() => {
      chars++;
      setTyped(noticed.slice(0, chars));
      if (chars >= noticed.length) clearInterval(timer);
    }, warmupTiming.typedCharacter);
    return () => clearInterval(timer);
  }, [noticed, reduced]);
  useEffect(() => {
    if (state.step !== 'watch' || state.noticed) {
      setFallback('');
      return;
    }
    let index = 0;
    const timer = setInterval(() => {
      setFallback(fallbacks[index % fallbacks.length] ?? '');
      index++;
    }, warmupTiming.fallback);
    return () => clearInterval(timer);
  }, [state.step, state.noticed]);
  useEffect(() => {
    let disposed = false;
    let connection: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let terminal = false;
    let handshake: ReturnType<typeof setTimeout> | undefined;
    setState(initialWarmupState);
    function reconnect(url: string) {
      clearTimeout(handshake);
      if (disposed || terminal) return;
      const delay = warmupTiming.reconnect[failures++];
      if (delay === undefined) {
        setState((current) => ({
          ...current,
          error: 'couldn’t connect to this session.',
        }));
        return;
      }
      timer = setTimeout(() => connect(url), delay);
    }
    function connect(url: string) {
      if (disposed || terminal) return;
      try {
        connection = api.connect(
          url,
          (event) => {
            if (disposed) return;
            setState((current) => warmupEvent(current, event));
            if (event.t === 'error') {
              terminal = true;
              connection?.close();
            }
            if (event.t === 'asset.added')
              setAssets((current) => [
                ...current.filter((asset) => asset.id !== event.asset.id),
                event.asset,
              ]);
            if (event.t === 'project.ops')
              void useProject
                .getState()
                .receive(sessionId, event.version, event.ops)
                .catch(() => undefined);
          },
          () => reconnect(url),
        );
        socket.current = connection;
        const current = connection;
        current.onopen = () => {
          failures = 0;
          clearTimeout(handshake);
        };
        handshake = setTimeout(() => {
          if (current.readyState !== WebSocket.OPEN) current.close();
        }, warmupTiming.reconnect[2]);
      } catch {
        reconnect(url);
      }
    }
    async function restore() {
      const draft =
        useSession.getState().draft ?? useSession.getState().restore();
      if (draft?.sessionId === sessionId && draft.wsUrl) connect(draft.wsUrl);
      try {
        const snapshot = await api.session(sessionId);
        if (disposed) return;
        setAssets(snapshot.assets);
        useProject.getState().replace(snapshot.project);
        if (snapshot.status === 'failed') {
          terminal = true;
          clearTimeout(timer);
          connection?.close();
          setState((current) => ({
            ...current,
            error: 'this session could not be started.',
          }));
          return;
        }
        if (snapshot.status === 'rendering') {
          router.replace(`/render/${encodeURIComponent(sessionId)}`);
          return;
        }
        if (snapshot.status === 'done' && snapshot.videoId) {
          router.replace(`/v/${encodeURIComponent(snapshot.videoId)}`);
          return;
        }
        if (
          snapshot.status === 'editing' ||
          snapshot.status === 'awaiting_review'
        )
          setState((current) => ({ ...current, step: 'ready', progress: 1 }));
        if (!connection) {
          if (snapshot.wsUrl) connect(snapshot.wsUrl);
          else
            setState((current) => ({
              ...current,
              error: 'this session has no live connection.',
            }));
        }
      } catch (error) {
        if (!disposed && !connection)
          setState((current) => ({
            ...current,
            error:
              error instanceof Error
                ? error.message
                : 'couldn’t restore this session.',
          }));
      }
    }
    void restore();
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(handshake);
      connection?.close();
      socket.current = undefined;
    };
  }, [sessionId, retry, router]);
  useEffect(() => {
    if (state.step !== 'plan' && state.step !== 'ready') return;
    router.prefetch(`/studio/${encodeURIComponent(sessionId)}`);
    void import('@kimo/compositor')
      .then((module) =>
        module.prefetchVideos(assets.filter((asset) => asset.kind === 'video')),
      )
      .catch(() => undefined);
  }, [state.step, assets, router, sessionId]);
  useEffect(() => {
    if (state.step !== 'ready' || state.error) return;
    const beat = setTimeout(
      () => setUnfolding(true),
      reduced ? 0 : warmupTiming.beat,
    );
    const transition = setTimeout(
      () => {
        const navigate = () =>
          router.replace(`/studio/${encodeURIComponent(sessionId)}`);
        if (document.startViewTransition)
          document.startViewTransition(navigate);
        else navigate();
      },
      reduced
        ? warmupTiming.crossfade
        : warmupTiming.beat + warmupTiming.unfold,
    );
    return () => {
      clearTimeout(beat);
      clearTimeout(transition);
    };
  }, [state.step, state.error, reduced, router, sessionId]);
  function stop() {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify({ t: 'pause' }));
    socket.current?.close();
    router.replace('/');
  }
  if (state.error)
    return (
      <main className="warmup-screen warmup-error">
        <div className="film-grain" aria-hidden="true" />
        <h1>couldn’t start this session</h1>
        <p>your files are still here. try again.</p>
        <p className="warmup-error-detail">{state.error}</p>
        <div>
          <Button onClick={() => setRetry((value) => value + 1)}>
            try again
          </Button>
          <Button variant="ghost" onClick={() => router.replace('/')}>
            back to home
          </Button>
        </div>
      </main>
    );
  const current = warmupSteps.indexOf(state.step);
  return (
    <main
      className="warmup-screen"
      data-ready="true"
      data-step={state.step}
      data-unfolding={unfolding || undefined}
    >
      <div className="film-grain" aria-hidden="true" />
      <div
        className="warmup-glow"
        style={{
          opacity:
            0.5 +
            0.5 *
              Math.min(
                1,
                (current +
                  (state.step === 'upload' ? progress : state.progress)) /
                  4,
              ),
        }}
        aria-hidden="true"
      />
      <header className="warmup-header">
        <span className="brand">
          <BrandMark />
          kimo
        </span>
        <Button variant="ghost" size="xs" onClick={() => setCancel(true)}>
          cancel
        </Button>
      </header>
      <section className="warmup-center" aria-label="preparing your edit">
        <WarmupReel
          assets={reelAssets}
          step={state.step}
          progress={progress}
          unfolding={unfolding}
        />
        <ol className="warmup-steps" aria-label="edit progress">
          {warmupSteps.map((step, index) => {
            const status =
              index < current
                ? 'done'
                : index === current
                  ? 'active'
                  : 'pending';
            return (
              <li
                key={step}
                data-status={status}
                data-failed={
                  (step === 'upload' && !!failed.length) || undefined
                }
              >
                <span className="warmup-step-icon" aria-hidden="true">
                  {status === 'done' ? (
                    <Check />
                  ) : status === 'active' ? (
                    <Spinner />
                  ) : (
                    <i />
                  )}
                </span>
                {step === 'upload' && failed.length ? (
                  <span>
                    {failed.length} files failed ·{' '}
                    <button
                      onClick={() =>
                        failed.forEach((item) =>
                          useUploads.getState().retry(item.localId),
                        )
                      }
                    >
                      retry
                    </button>
                  </span>
                ) : (
                  <span>
                    {status === 'done'
                      ? labels[step].done
                      : labels[step].active}
                    {step === 'upload' && status === 'active' && (
                      <span className="mono">
                        {' '}
                        · {Math.round(progress * 100)}%
                      </span>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <div className="warmup-noticed" key={noticed}>
          {noticed && (
            <>
              <i aria-hidden="true" />
              <span aria-hidden="true">{typed}</span>
              <span className="warmup-sr" role="status">
                {noticed}
              </span>
            </>
          )}
        </div>
      </section>
      <p className="warmup-bottom" data-slow={slow || undefined}>
        {slow
          ? 'taking longer than usual, big files take a moment'
          : 'usually ready in under a minute · you can leave this tab open'}
      </p>
      <Dialog open={cancel} onOpenChange={setCancel}>
        <DialogContent>
          <DialogTitle>stop this edit?</DialogTitle>
          <DialogDescription>
            your files stay uploaded for 24 hours.
          </DialogDescription>
          <DialogActions>
            <Button onClick={() => setCancel(false)}>keep going</Button>
            <Button variant="danger" onClick={stop}>
              stop
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </main>
  );
}
