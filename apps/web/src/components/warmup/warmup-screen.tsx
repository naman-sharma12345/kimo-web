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
import { diagnosticsTiming } from '@/lib/diagnostics';
import { api } from '@/lib/api';
import { createSessionRecovery } from '@/lib/session-recovery';
import { navigationTransition } from '@/lib/navigation-transition';
import { useProject } from '@/stores/project';
import { useUploads } from '@/lib/uploads';
import { WarmupReel, type ReelAsset } from './warmup-reel';
import { FullScreenError } from './full-screen-error';
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
  const [transportReady, setTransportReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [fallback, setFallback] = useState('');
  const [typed, setTyped] = useState('');
  const warmupObservation = useRef<
    ReturnType<typeof diagnosticsTiming.interval> | undefined
  >(undefined);
  const socket = useRef<WebSocket | undefined>(undefined);
  const recovery = useRef<ReturnType<typeof createSessionRecovery> | undefined>(
    undefined,
  );
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
    let latestStatus = 'warming';
    let active = true;
    const observe = diagnosticsTiming.interval('warmup_duration');
    warmupObservation.current = observe;
    setState(initialWarmupState);
    setUnfolding(false);
    const owner = createSessionRecovery({
      sessionId,
      api,
      onSnapshot(snapshot) {
        if (
          snapshot.project.version > useProject.getState().acknowledgedVersion
        )
          diagnosticsTiming.discard(sessionId);
        latestStatus = snapshot.status;
        observe(snapshot.status === 'warming' ? 'active' : 'reset');
        setAssets(snapshot.assets);
        // The project store preserves same-project queued intent. Shell additionally
        // restores its asset registry through the existing editing owner.
        useProject.getState().replace(snapshot.project);
        if (snapshot.status === 'rendering') {
          router.replace(`/render/${encodeURIComponent(sessionId)}`);
          return 'stop';
        }
        if (snapshot.status === 'done') {
          if (snapshot.videoId)
            router.replace(`/v/${encodeURIComponent(snapshot.videoId)}`);
          else
            setState((current) => ({
              ...current,
              error: 'this session has no finished video.',
            }));
          return 'stop';
        }
        return 'continue';
      },
      onEvent(event) {
        setState((current) => warmupEvent(current, event));
        if (event.t === 'error') recovery.current?.dispose();
        if (event.t === 'asset.added')
          setAssets((current) => [
            ...current.filter((asset) => asset.id !== event.asset.id),
            event.asset,
          ]);
        if (event.t === 'project.ops') {
          const before = useProject.getState().acknowledgedVersion;
          return useProject
            .getState()
            .receive(sessionId, event.version, event.ops)
            .then(() => {
              if (active)
                diagnosticsTiming.applied(
                  sessionId,
                  before,
                  useProject.getState().acknowledgedVersion,
                  event,
                );
            });
        }
      },
      onStatus(status) {
        setTransportReady(status === 'connected');
        if (status !== 'connected') setUnfolding(false);
        if (
          status === 'connected' &&
          (latestStatus === 'editing' || latestStatus === 'awaiting_review')
        )
          setState((current) => ({ ...current, step: 'ready', progress: 1 }));
      },
      onSocket(current) {
        socket.current = current;
      },
      onFatal(failure) {
        setState((current) => ({ ...current, error: failure.message }));
      },
    });
    recovery.current = owner;
    return () => {
      active = false;
      owner.dispose();
      if (recovery.current === owner) recovery.current = undefined;
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
    if (state.step !== 'ready' || state.error || !transportReady) return;
    warmupObservation.current?.('done');
    const beat = setTimeout(
      () => setUnfolding(true),
      reduced ? 0 : warmupTiming.beat,
    );
    let cancelNavigation: (() => void) | undefined;
    const transition = setTimeout(
      () => {
        const navigate = () =>
          router.replace(`/studio/${encodeURIComponent(sessionId)}`);
        cancelNavigation = navigationTransition(navigate, !!reduced);
      },
      reduced
        ? warmupTiming.crossfade
        : warmupTiming.beat + warmupTiming.unfold,
    );
    return () => {
      clearTimeout(beat);
      clearTimeout(transition);
      cancelNavigation?.();
    };
  }, [state.step, state.error, transportReady, reduced, router, sessionId]);
  function stop() {
    setTransportReady(false);
    setUnfolding(false);
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify({ t: 'pause' }));
    recovery.current?.dispose();
    router.replace('/');
  }
  if (state.error)
    return (
      <FullScreenError
        variant="session"
        detail={state.error}
        onRetry={() => setRetry((value) => value + 1)}
        onBack={() => router.replace('/')}
      />
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
            you’ll return to the start page. this requests a pause.
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
