'use client';
import * as React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { useTextModel } from './hooks';
import { focusWithoutScroll } from './selection';
import { TextSuggestion } from './text-suggestion';
import type { TextFieldProps } from './types';
import styles from './text-editing.module.css';

export function TextField({
  editing,
  clip,
  field = 'content',
  source = 'inspector',
  label = field === 'content' ? 'text content' : 'secondary text',
  autoFocus = false,
  selectAll = false,
  className,
  onFinish,
  inline = false,
}: TextFieldProps & { inline?: boolean }) {
  const { model, value } = useTextModel(editing, clip.id);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const composing = React.useRef(false);
  const finished = React.useRef(false);
  const pendingBlur = React.useRef(false);
  const onFinishRef = React.useRef(onFinish);
  onFinishRef.current = onFinish;
  React.useLayoutEffect(() => {
    if (autoFocus && ref.current) focusWithoutScroll(ref.current, selectAll);
  }, [autoFocus, selectAll, clip.id]);
  React.useEffect(() => {
    if (value.removed && !finished.current) {
      finished.current = true;
      onFinishRef.current?.('removed');
    }
  }, [value.removed]);
  if (clip.kind !== 'text' || !clip.text || value.removed) return null;
  return (
    <div
      className={`${styles.field} ${inline ? styles.inline : ''} ${className ?? ''}`}
      data-text-clip={clip.id}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (
          next instanceof Element &&
          (event.currentTarget.contains(next) ||
            next.closest('[data-text-clip]')?.getAttribute('data-text-clip') ===
              clip.id)
        )
          return;
        if (composing.current) {
          pendingBlur.current = true;
          return;
        }
        model.commit();
        if (!finished.current) {
          finished.current = true;
          onFinish?.('commit');
        }
      }}
    >
      <Textarea
        ref={ref}
        aria-label={label}
        value={value[field]}
        readOnly={clip.locked}
        aria-multiline="true"
        className={styles.input}
        onFocus={() => {
          finished.current = false;
          model.start(source);
        }}
        onChange={(event) => model.change(field, event.target.value, source)}
        onCompositionStart={() => {
          composing.current = true;
          model.composition(true);
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          model.change(field, event.currentTarget.value, source);
          model.composition(false);
          if (pendingBlur.current) {
            pendingBlur.current = false;
            model.commit();
            if (!finished.current) {
              finished.current = true;
              onFinish?.('commit');
            }
          }
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (
            composing.current ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229
          )
            return;
          if (event.key === 'Escape') {
            event.preventDefault();
            model.cancel();
            finished.current = true;
            onFinish?.('cancel');
          } else if (event.key === 'Enter' && (inline || isCaption(clip))) {
            event.preventDefault();
            model.commit();
            finished.current = true;
            onFinish?.('commit');
          }
        }}
        onKeyUp={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      />
      <TextSuggestion
        editing={editing}
        clipId={clip.id}
        restoreFocusRef={ref}
      />
      {value.error ? (
        <p role="alert" className={styles.error}>
          {value.error}
        </p>
      ) : null}
    </div>
  );
}
export function isCaption(clip: TextFieldProps['clip']) {
  return (
    clip.kind === 'text' &&
    ['caption', 'caption-clean', 'caption-pop', 'caption-box'].includes(
      clip.text?.style ?? '',
    )
  );
}
