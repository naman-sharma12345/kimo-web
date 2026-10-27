'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';
import type { Render, SessionSnapshot } from '@kimo/client';
import { api as defaultApi } from '@/lib/api';
import { spring } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogActions,
} from '@/components/ui/dialog';
import {
  cancelToEditing,
  pollRender,
  renderedChunk,
  renderStage,
  renderTiming,
  reopenEditing,
  resolveSession,
  type RenderApi,
} from '@/lib/render/lifecycle';
import {
  browserFrames,
  RenderFrames,
  type RenderFrame,
} from '@/lib/render/frames';
import {
  deliveryTransition,
  renderMotion,
  markRenderArrival,
  takeRenderPoster,
} from '@/lib/render/handoff';
import { mediaTime } from '@/lib/delivery/format';
import styles from './render.module.css';

export function RenderScreen({
  sessionId,
  snapshot,
  api = defaultApi,
}: {
  sessionId: string;
  snapshot: SessionSnapshot;
  api?: RenderApi;
}) {
  const router = useRouter();
  const reduced = !!useReducedMotion();
  const [authority, setAuthority] = React.useState(snapshot);
  const [render, setRender] = React.useState<Render>();
  const [frames, setFrames] = React.useState<readonly RenderFrame[]>([]);
  const [poster, setPoster] = React.useState<string>();
  const [notice, setNotice] = React.useState('');
  const [connection, setConnection] = React.useState('');
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [unknown, setUnknown] = React.useState(false);
  const mutation = React.useRef(false);
  const routed = React.useRef(false);
  const life = React.useRef(0);
  const posterBlob = React.useRef<
    { id: string; blob: Blob | undefined } | undefined
  >(undefined);
  const request = React.useRef<AbortController | undefined>(undefined);
  React.useEffect(() => () => request.current?.abort(), []);
  const resolution = resolveSession(authority);
  const jobId = resolution.kind === 'job' ? resolution.renderId : undefined;
  const destination =
    resolution.kind === 'video' ? resolution.videoId : undefined;
  const navigateVideo = React.useCallback(
    (videoId: string) => {
      if (routed.current) return;
      routed.current = true;
      markRenderArrival(videoId);
      deliveryTransition(
        () => router.replace(`/v/${encodeURIComponent(videoId)}`),
        reduced,
      );
    },
    [router, reduced],
  );
  React.useEffect(() => {
    if (posterBlob.current?.id !== sessionId)
      posterBlob.current = { id: sessionId, blob: takeRenderPoster(sessionId) };
    const blob = posterBlob.current.blob;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setPoster(url);
    return () => URL.revokeObjectURL(url);
  }, [sessionId]);
  React.useEffect(() => {
    life.current++;
    const generation = life.current;
    const abort = new AbortController();
    const restore = async () => {
      try {
        const fresh = await api.session(sessionId, { signal: abort.signal });
        if (generation !== life.current) return;
        setAuthority(fresh);
        setConnection('');
      } catch {
        if (!abort.signal.aborted)
          setConnection(
            'connection interrupted. checking again when this tab is active.',
          );
      }
    };
    const visible = () => {
      if (!document.hidden) void restore();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      life.current++;
      abort.abort();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [api, sessionId]);
  React.useEffect(() => {
    if (destination) navigateVideo(destination);
  }, [destination, navigateVideo]);
  React.useEffect(() => {
    if (!jobId) return;
    let active = true;
    const reel = new RenderFrames(browserFrames, (value) => {
      if (active) setFrames(value);
    });
    setFrames([]);
    setRender(undefined);
    const stop = pollRender(
      api,
      jobId,
      (value) => {
        setRender(value);
        setConnection('');
        if (Number.isSafeInteger(value.frame) && value.frame > 0)
          void reel.advance(
            value.frame,
            api.renderFrameUrl(jobId, value.frame),
          );
      },
      () => setConnection('connection interrupted. checking again…'),
    );
    return () => {
      active = false;
      stop();
      reel.dispose();
    };
  }, [api, jobId]);
  React.useEffect(() => {
    if (render?.status !== 'done' || !render.videoId) return;
    const videoId = render.videoId;
    const timer = setTimeout(
      () => navigateVideo(videoId),
      reduced ? renderTiming.reducedCompletion : renderTiming.completion,
    );
    return () => clearTimeout(timer);
  }, [render?.status, render?.videoId, navigateVideo, reduced]);
  const recheck = async () => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    const generation = life.current;
    const controller = new AbortController();
    request.current = controller;
    try {
      const fresh = await api.session(sessionId, { signal: controller.signal });
      if (generation !== life.current) return;
      setAuthority(fresh);
      if (fresh.status === 'editing') {
        routed.current = true;
        router.replace(`/studio/${encodeURIComponent(sessionId)}`);
      } else if (fresh.status === 'done' && fresh.videoId)
        navigateVideo(fresh.videoId);
      else
        setNotice(
          'the request outcome is still unknown. no request has been repeated.',
        );
    } catch {
      if (generation === life.current)
        setNotice('unable to check the request. no request has been repeated.');
    } finally {
      mutation.current = false;
      if (generation === life.current) setBusy(false);
    }
  };
  const editing = async (retry: boolean) => {
    if (mutation.current || unknown) return;
    mutation.current = true;
    setBusy(true);
    const generation = life.current;
    const controller = new AbortController();
    request.current = controller;
    try {
      const outcome =
        render &&
        (render.status === 'rendering' || render.status === 'queued') &&
        jobId
          ? await cancelToEditing(api, sessionId, jobId, controller.signal)
          : render?.status === 'cancelled'
            ? (await api.session(sessionId, { signal: controller.signal }))
                .status === 'editing'
              ? { kind: 'editing' as const }
              : { kind: 'unknown' as const }
            : await reopenEditing(api, sessionId, controller.signal);
      if (generation !== life.current) return;
      if (outcome.kind === 'editing') {
        routed.current = true;
        router.replace(
          `/studio/${encodeURIComponent(sessionId)}${retry ? '?review=render' : ''}`,
        );
      } else if (outcome.kind === 'done') navigateVideo(outcome.videoId);
      else {
        setUnknown(true);
        setNotice(
          'the request outcome is unknown. check status before continuing.',
        );
      }
    } catch (error) {
      if (generation === life.current)
        setNotice(
          error instanceof Error ? error.message : 'unable to reopen this edit',
        );
    } finally {
      mutation.current = false;
      if (generation === life.current) {
        setBusy(false);
        setConfirmCancel(false);
      }
    }
  };
  const done = render?.status === 'done';
  const failed = render?.status === 'failed';
  const cancelled = render?.status === 'cancelled';
  const chunk = render ? renderedChunk(render) : undefined;
  const latest = frames.at(-1);
  return (
    <main
      className={styles.scene}
      data-render-ready
      data-state={done ? 'done' : failed ? 'failed' : 'running'}
    >
      <div className={styles.grain} aria-hidden="true" />
      <nav className={styles.nav} aria-label="render navigation">
        <a href="/" aria-label="kimo home">
          <img src="/brand/kimo-mark.svg" alt="" />
          kimo
        </a>
        <Button
          size="xs"
          variant="ghost"
          disabled={!render || busy || unknown || done}
          onClick={() =>
            failed || cancelled ? void editing(false) : setConfirmCancel(true)
          }
        >
          back to editing
        </Button>
      </nav>
      <section className={styles.content} aria-label="render progress">
        <div className={styles.horizon} aria-hidden="true" />
        <div
          className={styles.frame}
          style={{
            aspectRatio: `${authority.project.width} / ${authority.project.height}`,
          }}
        >
          {poster && !latest && (
            <img src={poster} alt="review poster" className={styles.poster} />
          )}
          <AnimatePresence initial={false}>
            {latest && (
              <motion.img
                key={latest.url}
                src={latest.url}
                alt="illustrative mock frame, not a composed project frame"
                className={styles.preview}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: reduced
                    ? renderMotion.reducedFade
                    : renderMotion.frameFade,
                }}
              />
            )}
          </AnimatePresence>
          {!latest && !poster && (
            <span className={styles.placeholder}>
              waiting for the first frame
            </span>
          )}
          {!reduced &&
            !failed &&
            !cancelled &&
            (done || (chunk !== undefined && chunk > 0)) && (
              <div
                key={done ? 'final' : chunk}
                className={styles.scan}
                data-final={done || undefined}
                aria-hidden="true"
              />
            )}
          {done && (
            <div className={styles.completion} aria-hidden="true">
              <div className={styles.bars}>
                {[0, 1, 2, 3].map((bar) => (
                  <motion.i
                    key={bar}
                    initial={{
                      y: reduced ? 0 : renderMotion.barRise,
                      opacity: 0,
                    }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={
                      reduced
                        ? { duration: renderMotion.stageFade }
                        : {
                            ...spring.snappy,
                            delay: bar * renderMotion.barStagger,
                          }
                    }
                  />
                ))}
              </div>
              <Check className={styles.check} />
            </div>
          )}
        </div>
        <div
          className={styles.progress}
          role="progressbar"
          aria-label="render progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={render ? Math.round(render.progress * 100) : undefined}
        >
          <span
            style={{ width: `${done ? 100 : (render?.progress ?? 0) * 100}%` }}
          />
        </div>
        <div className={styles.numbers}>
          <span>
            {render
              ? `frame ${render.frame} of ${render.totalFrames}`
              : 'waiting for render status'}
          </span>
          <span>
            {render && !done && !failed && !cancelled
              ? `about ${mediaTime(render.etaSec)} left`
              : ''}
          </span>
        </div>
        {failed ? (
          <div className={styles.failure}>
            <h1>the render hit a problem</h1>
            {render.error && <p>{render.error.message}</p>}
            <Button
              variant="primary"
              disabled={busy || unknown}
              onClick={() => void editing(true)}
            >
              try again
            </Button>
            <Button
              disabled={busy || unknown}
              onClick={() => void editing(false)}
            >
              back to editing
            </Button>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.p
              key={
                cancelled
                  ? 'cancelled'
                  : render
                    ? renderStage(render.progress)
                    : 'loading'
              }
              className={styles.stage}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: renderMotion.stageFade }}
            >
              {cancelled
                ? 'render cancelled'
                : render
                  ? renderStage(render.progress)
                  : 'checking render status'}
            </motion.p>
          </AnimatePresence>
        )}
        <div className={styles.filmstrip} aria-label="last rendered frames">
          {frames.map((item, index) => (
            <motion.img
              key={item.url}
              src={item.url}
              alt={`illustrative frame ${item.frame}`}
              initial={{ x: reduced ? 0 : renderMotion.tileSlide, opacity: 0 }}
              animate={{ x: 0, opacity: index === frames.length - 1 ? 1 : 0.4 }}
              transition={
                reduced ? { duration: renderMotion.reducedFade } : spring.snappy
              }
            />
          ))}
        </div>
        <p className={styles.disclosure}>
          mock preview: pre-generated JPEGs are illustrative, not project
          composition. progress is synthetic.
        </p>
        {done && !render.videoId && (
          <p role="status">
            render finished without a video identifier. delivery is not
            available yet.
          </p>
        )}
        {resolution.kind === 'unresolved' && (
          <p role="status">
            no render identifier is available for this session. return to the
            studio to review it.
          </p>
        )}
        <p role="status">{connection || notice}</p>
        {unknown && (
          <Button onClick={() => void recheck()} disabled={busy}>
            check status
          </Button>
        )}
      </section>
      <footer className={styles.footer}>
        <p>
          you can close this tab, we’ll keep rendering. come back to this link
          anytime.
        </p>
        <p>
          mock sessions can only be restored while this server process stays
          alive.
        </p>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(window.location.href).then(
              () => setNotice('link copied'),
              () => setNotice('unable to copy link'),
            );
          }}
        >
          copy link
        </Button>
      </footer>
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogTitle>cancel the render?</DialogTitle>
          <DialogDescription>
            you’ll return to the studio with everything as it was.
          </DialogDescription>
          <DialogActions>
            <Button disabled={busy} onClick={() => setConfirmCancel(false)}>
              keep rendering
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void editing(false)}
            >
              cancel render
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </main>
  );
}
