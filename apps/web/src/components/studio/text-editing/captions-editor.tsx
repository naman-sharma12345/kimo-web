'use client';
import * as React from 'react';
import { Trash2 } from 'lucide-react';
import type { Clip, Op } from '@kimo/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Segmented, SegmentedItem } from '@/components/ui/segmented';
import { deleteClips } from '@/lib/editing/commands';
import { useEditingState } from './hooks';
import { InspectorTextField } from './inspector-text-field';
import {
  CAPTION_STYLES,
  captionClips,
  captionTime,
  joinCaptions,
  replaceCaptions,
  retimeCaption,
  splitCaption,
  styleCaptions,
} from './caption-commands';
import type { CaptionsEditorProps } from './types';
import styles from './text-editing.module.css';

export function CaptionsEditor({
  editing,
  trackId,
  playhead,
  onSeek,
  className,
}: CaptionsEditorProps) {
  const state = useEditingState(editing);
  const project = state.project;
  const clips = captionClips(project, trackId);
  const ids = clips.map((clip) => clip.id);
  const [find, setFind] = React.useState('');
  const [replace, setReplace] = React.useState('');
  const [error, setError] = React.useState<string>();
  const run = (build: () => Op[], label: string) => {
    try {
      const ops = build();
      if (!ops.length) return;
      setError(undefined);
      void editing
        .editGroup(ops, label, 'captions')
        .then((result) => {
          if (result.status === 'failed') setError(result.error);
        })
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error ? cause.message : 'caption edit unavailable',
          ),
        );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'caption edit unavailable',
      );
    }
  };
  return (
    <section
      className={`${styles.captions} ${className ?? ''}`}
      aria-label="captions editor"
    >
      <div className={styles.toolbar}>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost">
              find &amp; replace
            </Button>
          </PopoverTrigger>
          <PopoverContent aria-label="find & replace">
            <div className={styles.replace}>
              <Input
                aria-label="find"
                value={find}
                onChange={(event) => setFind(event.target.value)}
              />
              <Input
                aria-label="replace with"
                value={replace}
                onChange={(event) => setReplace(event.target.value)}
              />
              <Button
                size="sm"
                disabled={!find || !ids.length}
                onClick={() =>
                  run(
                    () =>
                      replaceCaptions(
                        editing.getState().project,
                        ids,
                        find,
                        replace,
                      ),
                    'replace all captions',
                  )
                }
              >
                replace all
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <label className={styles.control}>
          style
          <select
            aria-label="caption style"
            value={
              clips[0]?.text?.style === 'caption'
                ? 'caption-clean'
                : (clips[0]?.text?.style ?? 'caption-clean')
            }
            disabled={!clips.length}
            onChange={(event) => {
              const style = CAPTION_STYLES.find(
                (item) => item === event.target.value,
              );
              if (style)
                run(
                  () =>
                    styleCaptions(editing.getState().project, ids, { style }),
                  'caption style',
                );
            }}
          >
            {CAPTION_STYLES.map((style) => (
              <option key={style}>{style}</option>
            ))}
          </select>
        </label>
        <div className={styles.control}>
          <span>position</span>
          <Segmented
            aria-label="caption position"
            value={clips[0]?.text?.position ?? 'bottom'}
            onValueChange={(position) => {
              if (
                position === 'bottom' ||
                position === 'middle' ||
                position === 'top'
              )
                run(
                  () =>
                    styleCaptions(editing.getState().project, ids, {
                      position,
                    }),
                  'caption position',
                );
            }}
          >
            {(['bottom', 'middle', 'top'] as const).map((position) => (
              <SegmentedItem
                key={position}
                value={position}
                disabled={!clips.length}
              >
                {position}
              </SegmentedItem>
            ))}
          </Segmented>
        </div>
      </div>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <div className={styles.captionList}>
        {clips.map((clip, index) => (
          <CaptionRow
            key={clip.id}
            clip={clip}
            next={clips[index + 1]}
            editing={editing}
            playhead={playhead}
            onSeek={onSeek}
            run={run}
          />
        ))}
        {!clips.length ? (
          <p className={styles.pending}>no captions on this track</p>
        ) : null}
      </div>
    </section>
  );
}
function CaptionRow({
  clip,
  next,
  editing,
  playhead,
  onSeek,
  run,
}: {
  clip: Clip;
  next?: Clip;
  editing: CaptionsEditorProps['editing'];
  playhead: number;
  onSeek: CaptionsEditorProps['onSeek'];
  run: (ops: () => Op[], label: string) => void;
}) {
  const [wordIndex, setWordIndex] = React.useState(1);
  const active =
    playhead >= clip.start && playhead < clip.start + clip.duration;
  return (
    <div
      className={styles.captionRow}
      data-active={active}
      aria-current={active ? 'true' : undefined}
    >
      <div className={styles.captionHeading}>
        <button
          type="button"
          className={styles.time}
          aria-label={`seek to caption ${captionTime(clip.start)}`}
          onClick={() => onSeek(clip.start)}
        >
          {captionTime(clip.start)}
        </button>
        <Button
          iconOnly
          tooltip="delete caption"
          aria-label="delete caption"
          variant="ghost"
          size="xs"
          disabled={clip.locked}
          onClick={() =>
            run(
              () =>
                deleteClips(editing.getState().project, [clip.id], {
                  lift: true,
                }),
              'delete caption',
            )
          }
        >
          <Trash2 className={styles.trash} />
        </Button>
      </div>
      <InspectorTextField
        editing={editing}
        clip={clip}
        source="captions"
        label={`caption at ${captionTime(clip.start)}`}
      />
      <div
        role="group"
        aria-label="caption timing"
        className={styles.captionTiming}
      >
        <label htmlFor={`caption-start-${clip.id}`}>
          start
          <Input
            type="number"
            onKeyDown={(event) => event.stopPropagation()}
            id={`caption-start-${clip.id}`}
            aria-label={`caption ${clip.id} start seconds`}
            step={1 / 30}
            defaultValue={clip.start}
            key={`start-${clip.start}`}
            disabled={clip.locked}
            onBlur={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isFinite(value) && value !== clip.start)
                run(
                  () =>
                    retimeCaption(
                      editing.getState().project,
                      clip.id,
                      'in',
                      value,
                    ),
                  'retime caption',
                );
            }}
          />
        </label>
        <label htmlFor={`caption-end-${clip.id}`}>
          end
          <Input
            type="number"
            onKeyDown={(event) => event.stopPropagation()}
            id={`caption-end-${clip.id}`}
            aria-label={`caption ${clip.id} end seconds`}
            step={1 / 30}
            defaultValue={clip.start + clip.duration}
            key={`end-${clip.start + clip.duration}`}
            disabled={clip.locked}
            onBlur={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (
                Number.isFinite(value) &&
                value !== clip.start + clip.duration
              )
                run(
                  () =>
                    retimeCaption(
                      editing.getState().project,
                      clip.id,
                      'out',
                      value,
                    ),
                  'retime caption',
                );
            }}
          />
        </label>
        <label htmlFor={`caption-split-${clip.id}`}>
          split before word
          <Input
            type="number"
            onKeyDown={(event) => event.stopPropagation()}
            min={1}
            id={`caption-split-${clip.id}`}
            aria-label={`caption ${clip.id} split word index`}
            value={wordIndex}
            onChange={(event) =>
              setWordIndex(event.currentTarget.valueAsNumber)
            }
          />
        </label>
        <Button
          size="xs"
          variant="ghost"
          disabled={clip.locked || !active}
          onClick={() =>
            run(
              () =>
                splitCaption(
                  editing.getState().project,
                  clip.id,
                  playhead,
                  wordIndex,
                  crypto.randomUUID(),
                ),
              'split caption',
            )
          }
        >
          split at playhead
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={clip.locked || !next || next.locked}
          onClick={() => {
            if (next)
              run(
                () =>
                  joinCaptions(editing.getState().project, clip.id, next.id),
                'join captions',
              );
          }}
        >
          join next
        </Button>
      </div>
    </div>
  );
}
/** Existing Dialog primitives, not a parallel modal/focus-trap implementation. */
export function CaptionsEditorDialog({
  open,
  onOpenChange,
  ...props
}: CaptionsEditorProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className={styles.captionDialog}>
        <DialogTitle>captions</DialogTitle>
        <DialogClose asChild>
          <Button variant="ghost" size="sm">
            close captions
          </Button>
        </DialogClose>
        <DialogDescription>edit caption text and timing</DialogDescription>
        <CaptionsEditor {...props} />
      </DialogContent>
    </Dialog>
  );
}
