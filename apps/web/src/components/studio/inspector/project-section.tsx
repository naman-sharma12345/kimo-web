'use client';
import * as React from 'react';
import type { KimoProject } from '@kimo/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogActions,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Row } from '@/components/ui/row';
import { Select, Reason } from './controls';
import type { InspectorEditorProps } from './types';
import { FieldTransaction } from './transaction';
import styles from './inspector.module.css';
const aspects = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
} as const;
const backgrounds: Record<string, NonNullable<KimoProject['background']>> = {
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  cream: [245 / 255, 241 / 255, 231 / 255, 1],
};
function ProjectNotes({
  props,
  report,
}: {
  props: InspectorEditorProps;
  report(message: string): void;
}) {
  const [value, setValue] = React.useState<string | null>(null);
  const tx = React.useRef<FieldTransaction | null>(null),
    draft = React.useRef('');
  const previewTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    idleTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
  const composing = React.useRef(false);
  const clear = () => {
    clearTimeout(previewTimer.current);
    clearTimeout(idleTimer.current);
  };
  const preview = () => {
    try {
      tx.current ??= new FieldTransaction(
        props.editing,
        [],
        'project notes for kimo',
      );
      tx.current.preview(() => [
        { op: 'project.update', patch: { notes: draft.current } },
      ]);
    } catch (e) {
      report(String(e));
    }
  };
  const commit = () => {
    clear();
    if (!tx.current) return;
    preview();
    const pending = tx.current;
    tx.current = null;
    void pending
      ?.commit()
      ?.then((r) => {
        if (r.status === 'failed')
          report(r.error ?? 'Project notes were not saved.');
      })
      .catch((e) => report(String(e)));
    setValue(null);
  };
  const schedule = () => {
    clear();
    previewTimer.current = setTimeout(preview, 150);
    idleTimer.current = setTimeout(commit, 800);
  };
  React.useEffect(
    () => () => {
      clearTimeout(previewTimer.current);
      clearTimeout(idleTimer.current);
      tx.current?.cancel();
    },
    [props.editing],
  );
  return (
    <Textarea
      aria-label="project notes for kimo"
      placeholder="project notes for kimo"
      value={value ?? props.project.notes ?? ''}
      onChange={(e) => {
        draft.current = e.target.value;
        setValue(draft.current);
        tx.current ??= new FieldTransaction(
          props.editing,
          [],
          'project notes for kimo',
        );
        tx.current.begin();
        if (!composing.current) schedule();
      }}
      onCompositionStart={() => {
        composing.current = true;
        clear();
      }}
      onCompositionEnd={() => {
        composing.current = false;
        schedule();
      }}
      onBlur={() => {
        composing.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          clear();
          tx.current?.cancel();
          tx.current = null;
          setValue(null);
        }
      }}
    />
  );
}
export function ProjectSection({
  props,
  report,
}: {
  props: InspectorEditorProps;
  report(message: string): void;
}) {
  const [requested, setRequested] = React.useState<keyof typeof aspects | null>(
      null,
    ),
    [reframing, setReframing] = React.useState(false),
    [pending, setPending] = React.useState(false);
  const aspect =
    props.project.width === props.project.height
      ? '1:1'
      : props.project.width > props.project.height
        ? '16:9'
        : '9:16';
  const background =
    Object.entries(backgrounds).find(([, color]) =>
      color.every(
        (v, i) =>
          Math.abs(v - ((props.project.background ?? [0, 0, 0, 1])[i] ?? 0)) <
          1e-6,
      ),
    )?.[0] ?? 'custom';
  const edit = (
    patch: Extract<
      import('@kimo/client').Op,
      { op: 'project.update' }
    >['patch'],
    label: string,
  ) =>
    props.editing.editGroup(
      [{ op: 'project.update', patch }],
      label,
      'inspector',
    );
  return (
    <>
      <Select
        label="aspect"
        value={aspect}
        options={Object.keys(aspects).map((value) => ({ value, label: value }))}
        onChange={(next) => {
          if (next !== aspect) setRequested(next as keyof typeof aspects);
        }}
      />
      <Dialog
        open={requested !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setRequested(null);
        }}
      >
        <DialogContent aria-describedby="inspector-aspect-description">
          <DialogTitle>change the frame?</DialogTitle>
          <DialogDescription id="inspector-aspect-description">
            change the frame? kimo will reframe every clip.
          </DialogDescription>
          <DialogActions>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => setRequested(null)}
            >
              cancel
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                if (!requested) return;
                const size = aspects[requested];
                setPending(true);
                void edit(size, 'change the frame')
                  .then(async (result) => {
                    if (
                      result.status === 'cancelled' ||
                      result.status === 'failed'
                    ) {
                      report(result.error ?? 'The frame could not be changed.');
                      return;
                    }
                    setRequested(null);
                    setReframing(true);
                    if (props.onReframeRequest)
                      await props.onReframeRequest(size);
                  })
                  .catch((e) =>
                    report(
                      e instanceof Error
                        ? e.message
                        : 'The reframe request failed.',
                    ),
                  )
                  .finally(() => setPending(false));
              }}
            >
              change frame
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
      {reframing && (
        <Reason>
          {props.onReframeRequest
            ? 'Frame dimensions changed; clip reframing awaits the parent engine response.'
            : 'Frame dimensions changed. Clip reframing is pending: no engine reframe callback is connected.'}
        </Reason>
      )}
      <Row
        label="duration"
        value={
          <span className={styles.metadata}>
            {props.project.duration.toFixed(2)} s
          </span>
        }
      />
      <Row
        label="fps"
        value={<span className={styles.metadata}>{props.project.fps}</span>}
      />
      <Select
        label="background colour"
        value={background}
        options={[
          ...Object.keys(backgrounds).map((value) => ({ value, label: value })),
          ...(background === 'custom'
            ? [{ value: 'custom', label: 'custom', disabled: true }]
            : []),
        ]}
        onChange={(next) => {
          const color = backgrounds[next];
          if (color)
            void edit({ background: color }, 'background colour')
              .then((r) => {
                if (r.status === 'failed')
                  report(r.error ?? 'The background was not saved.');
              })
              .catch((e) => report(String(e)));
        }}
      />
      <ProjectNotes props={props} report={report} />
    </>
  );
}
