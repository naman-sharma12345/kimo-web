'use client';
import * as React from 'react';
import type { KimoProject } from '@kimo/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogActions,
} from '@/components/ui/dialog';
import { Row } from '@/components/ui/row';
import { Toggle } from '@/components/ui/toggle';
import { isCaptionClip } from '../text-editing/caption-commands';
import type { StudioCompositorHandle } from '../compositor-bridge';
import styles from './review.module.css';

export type PosterResult = Awaited<
  ReturnType<NonNullable<StudioCompositorHandle['getFrame']>>
>;
export interface ReviewRenderOptions {
  burnInCaptions: boolean;
  expectedProjectVersion: number;
  title: string;
}
export interface ReviewDialogProps {
  open: boolean;
  project: KimoProject;
  title: string;
  ready: boolean;
  pending?: boolean;
  getFrame?: StudioCompositorHandle['getFrame'];
  onOpenChange: (open: boolean) => void;
  onKeepEditing: () => void;
  onRender: (options: ReviewRenderOptions) => void;
  onPoster?: (poster: PosterResult | null) => void;
}
export function reviewLength(duration: number): string {
  const seconds = Math.max(0, Math.floor(duration));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
export function reviewFormat(
  project: Pick<KimoProject, 'width' | 'height'>,
): string {
  const divisor = gcd(project.width, project.height);
  return `1080p · ${project.width / divisor}:${project.height / divisor} · 30 fps · mp4`;
}
export function ReviewDialog(props: ReviewDialogProps) {
  // Each opening/version gets a fresh caption default and capture transaction.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <ReviewContent
          key={`${props.project.id}:${props.project.version}`}
          {...props}
        />
      ) : null}
    </Dialog>
  );
}
function ReviewContent({
  project,
  title,
  ready,
  pending = false,
  getFrame,
  onKeepEditing,
  onRender,
  onPoster,
}: ReviewDialogProps) {
  const hasCaptions = Object.values(project.clips).some(isCaptionClip);
  const [burnInCaptions, setBurnInCaptions] = React.useState(hasCaptions);
  const [poster, setPoster] = React.useState<string | null>(null);
  const [posterState, setPosterState] = React.useState<
    'loading' | 'unavailable' | 'ready'
  >(getFrame ? 'loading' : 'unavailable');
  const captureCallback = React.useRef(getFrame);
  captureCallback.current = getFrame;
  const canCapture = !!getFrame;
  const posterCallback = React.useRef(onPoster);
  posterCallback.current = onPoster;
  React.useEffect(() => {
    const abort = new AbortController();
    let url: string | null = null;
    setPoster(null);
    posterCallback.current?.(null);
    if (!canCapture) {
      setPosterState('unavailable');
      return;
    }
    setPosterState('loading');
    // Defer initiation one microtask so StrictMode's first cleanup aborts before
    // acquiring the sole controller transaction.
    void Promise.resolve()
      .then(() => {
        if (abort.signal.aborted) throw new Error('poster capture aborted');
        const capture = captureCallback.current;
        if (!capture) throw new Error('poster capture unavailable');
        return capture(1, { signal: abort.signal });
      })
      .then((result) => {
        if (abort.signal.aborted) return;
        if (
          result.projectVersion !== project.version ||
          !result.blob.size ||
          result.width <= 0 ||
          result.height <= 0
        )
          throw new Error('poster revision or readback unavailable');
        url = URL.createObjectURL(result.blob);
        setPoster(url);
        setPosterState('ready');
        posterCallback.current?.(result);
      })
      .catch(() => {
        if (!abort.signal.aborted) setPosterState('unavailable');
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
      posterCallback.current?.(null);
    };
  }, [canCapture, project.id, project.version]);
  return (
    <DialogContent size="md" aria-describedby={undefined}>
      <DialogTitle>ready to render?</DialogTitle>
      <div className={styles.poster} data-poster-state={posterState}>
        {poster ? (
          <img src={poster} alt={`current frame of ${title}`} />
        ) : (
          <span role="status">
            {posterState === 'loading'
              ? 'preparing poster'
              : 'poster unavailable'}
          </span>
        )}
      </div>
      <div className={styles.summary} aria-label="requested render settings">
        <Row label="length" value={reviewLength(project.duration)} />
        <Row label="format" value={reviewFormat(project)} />
        <Row label="audio" value="stereo · 48 kHz" />
      </div>
      <Row
        label={<label htmlFor="review-burn-captions">burn in captions</label>}
        value={
          <Toggle
            id="review-burn-captions"
            aria-label="burn in captions"
            className={styles.captionToggle}
            checked={burnInCaptions}
            disabled={!hasCaptions || pending}
            onCheckedChange={setBurnInCaptions}
          />
        }
      />
      <DialogActions>
        <Button disabled={pending} onClick={onKeepEditing}>
          keep editing
        </Button>
        <Button
          variant="primary"
          disabled={!ready || !title.trim()}
          loading={pending}
          onClick={() =>
            onRender({
              burnInCaptions,
              expectedProjectVersion: project.version,
              title,
            })
          }
        >
          render 1080p
        </Button>
      </DialogActions>
    </DialogContent>
  );
}
