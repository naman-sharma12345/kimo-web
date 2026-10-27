'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import { Download, Link as LinkIcon, Share, Pencil } from 'lucide-react';
import type { Video } from '@kimo/client';
import { api } from '@/lib/api';
import { spring } from '@/lib/motion';
import { deliveryMotion } from '@/lib/delivery/motion';
import { consumeRenderArrival } from '@/lib/render/handoff';
import { reopenEditing } from '@/lib/render/lifecycle';
import {
  downloadFilename,
  editAvailability,
  safeMediaUrl,
  shareLinks,
  videoMeta,
} from '@/lib/delivery/format';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { VideoPlayer } from './video-player';
import styles from './delivery.module.css';

export function DeliveryScreen({
  videoId,
  video,
  canEdit = false,
}: {
  videoId: string;
  video: Video;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const reduced = !!useReducedMotion();
  const [notice, setNotice] = React.useState('');
  const [fallback, setFallback] = React.useState(false);
  const [href, setHref] = React.useState('');
  const [arrived, setArrived] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [unknown, setUnknown] = React.useState(false);
  const [now, setNow] = React.useState<number>();
  const mounted = React.useRef(false);
  const dispatched = React.useRef(false);
  const arrival = React.useRef<{ id: string; value: boolean } | undefined>(
    undefined,
  );
  React.useEffect(() => {
    mounted.current = true;
    setHref(window.location.href);
    if (arrival.current?.id !== videoId)
      arrival.current = { id: videoId, value: consumeRenderArrival(videoId) };
    setArrived(arrival.current.value);
    setNow(Date.now());
    const expiry = video.editExpiresAt
      ? Date.parse(video.editExpiresAt)
      : undefined;
    const timer =
      expiry && expiry > Date.now()
        ? setTimeout(
            () => setNow(Date.now()),
            Math.min(expiry - Date.now(), 2_147_483_647),
          )
        : undefined;
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [videoId, video.editExpiresAt]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      if (mounted.current) setNotice('link copied');
    } catch {
      if (mounted.current) setNotice('unable to copy link');
    }
  };
  const share = async () => {
    if (typeof navigator.share !== 'function') {
      setFallback(true);
      return;
    }
    try {
      await navigator.share({ title: video.title, url: window.location.href });
    } catch (error) {
      if (
        mounted.current &&
        !(
          typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          error.name === 'AbortError'
        )
      ) {
        setFallback(true);
        setNotice('sharing is unavailable. choose a link below.');
      }
    }
  };
  const edit = async () => {
    if (!video.sessionId || dispatched.current) return;
    dispatched.current = true;
    setBusy(true);
    try {
      const result = await reopenEditing(api, video.sessionId);
      if (!mounted.current) return;
      if (result.kind === 'editing')
        router.push(`/studio/${encodeURIComponent(video.sessionId)}`);
      else {
        setUnknown(true);
        setNotice(
          'the edit request outcome is unknown. no request has been repeated.',
        );
      }
    } catch (error) {
      if (mounted.current)
        setNotice(
          error instanceof Error ? error.message : 'unable to reopen this edit',
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  // Expiry is only meaningful with an observed client instant; ownership remains separate.
  const availability =
    now === undefined ? 'unknown' : editAvailability(video, canEdit, now);
  const expiredDownload =
    now !== undefined &&
    video.downloadExpiresAt !== undefined &&
    Date.parse(video.downloadExpiresAt) <= now;
  const downloadUrl = safeMediaUrl(video.url);
  const editTitle =
    availability === 'expired'
      ? 'this edit has expired'
      : availability === 'unknown'
        ? 'editing requires verified ownership and an available edit session'
        : undefined;
  return (
    <main
      className={styles.page}
      data-delivery-ready
      data-arrived={arrived || undefined}
    >
      <div className={styles.grain} aria-hidden="true" />
      <nav className={styles.nav} aria-label="delivery navigation">
        <a href="/" aria-label="kimo home">
          <img src="/brand/kimo-mark.svg" alt="" />
          kimo
        </a>
        <a className="ui-button ui-button-secondary" data-size="sm" href="/">
          make another
        </a>
      </nav>
      <header className={styles.headline}>
        <motion.p
          initial={
            reduced || arrived
              ? false
              : { opacity: 0, y: deliveryMotion.headlineRise }
          }
          animate={{ opacity: 1, y: 0 }}
          transition={spring.soft}
        >
          your video is ready
        </motion.p>
        <motion.h1
          initial={
            reduced || arrived
              ? false
              : { opacity: 0, y: deliveryMotion.headlineRise }
          }
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.soft, delay: deliveryMotion.headlineStagger }}
        >
          {video.title}
        </motion.h1>
      </header>
      <motion.section
        className={styles.playerArea}
        aria-label="finished video"
        initial={
          reduced || arrived
            ? false
            : { opacity: 0, scale: deliveryMotion.playerScale }
        }
        animate={{ opacity: 1, scale: 1 }}
        transition={spring.soft}
      >
        <div className={styles.horizon} aria-hidden="true" />
        <VideoPlayer video={video} />
      </motion.section>
      <motion.div
        className={styles.actions}
        initial={reduced || arrived ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {downloadUrl && !expiredDownload ? (
          <a
            className={`ui-button ui-button-primary ${styles.download}`}
            data-size="lg"
            download={downloadFilename(video.title)}
            href={downloadUrl}
          >
            <Download aria-hidden="true" />
            download mp4
          </a>
        ) : (
          <Button variant="primary" size="lg" disabled>
            download mp4
          </Button>
        )}
        <Button size="lg" onClick={() => void copy()}>
          <LinkIcon aria-hidden="true" />
          copy link
        </Button>
        <Popover open={fallback} onOpenChange={setFallback}>
          <PopoverTrigger asChild>
            <Button
              size="lg"
              onClick={(event) => {
                event.preventDefault();
                void share();
              }}
            >
              <Share aria-hidden="true" />
              share
            </Button>
          </PopoverTrigger>
          <PopoverContent aria-label="share video">
            <div className={styles.shareLinks}>
              {shareLinks(href).map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.label}
                </a>
              ))}
              <Button onClick={() => void copy()}>copy link</Button>
            </div>
          </PopoverContent>
        </Popover>
        <span title={editTitle}>
          <Button
            size="lg"
            variant="ghost"
            disabled={availability !== 'available' || busy || unknown}
            onClick={() => void edit()}
          >
            <Pencil aria-hidden="true" />
            edit again
          </Button>
        </span>
      </motion.div>
      {availability === 'unknown' && (
        <p className={styles.boundary}>
          this public link is read-only. editing requires verified ownership and
          an available edit session.
        </p>
      )}
      {expiredDownload && (
        <p role="status">
          the download link has expired. refresh to request current server
          metadata.
        </p>
      )}
      {unknown && (
        <Button
          onClick={() => {
            void api.session(video.sessionId ?? '').then(
              (snapshot) => {
                if (snapshot.status === 'editing' && mounted.current)
                  router.push(
                    `/studio/${encodeURIComponent(video.sessionId ?? '')}`,
                  );
                else if (mounted.current)
                  setNotice('the edit outcome is still unknown.');
              },
              () => {
                if (mounted.current)
                  setNotice('unable to check the edit outcome.');
              },
            );
          }}
        >
          check status
        </Button>
      )}
      <p className={styles.meta}>{videoMeta(video).join(' · ')}</p>
      <p role="status" className={styles.notice}>
        {notice}
      </p>
      <details className={styles.history}>
        <summary>how kimo made it</summary>
        {video.history?.length ? (
          <ul>
            {video.history.map((item, index) => (
              <li key={index}>
                {item.summary} · {item.stepCount} steps
              </li>
            ))}
          </ul>
        ) : (
          <p>action history is not available for this video.</p>
        )}
        {video.models?.length ? (
          <p>models used: {video.models.join(', ')}</p>
        ) : null}
      </details>
      <p className={styles.boundary}>
        mock preview: this is a pre-generated eight-second silent test pattern,
        not an engine render or your composition.
      </p>
      <footer className={styles.footer}>
        <span>kimo · open source video editing</span>
        <div>
          <a href="https://github.com/naman-sharma12345/kimo">github</a>
          <a href="https://getkimo.tech">getkimo.tech</a>
        </div>
      </footer>
    </main>
  );
}
