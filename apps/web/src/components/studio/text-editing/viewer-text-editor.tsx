'use client';
import * as React from 'react';
import type { ViewerTextEditorProps, ViewerTextLayout } from './types';
import { useTextModel } from './hooks';
import { editableText, focusWithoutScroll, insertPlainText } from './selection';
import { isCaption } from './text-field';
import { TextSuggestion } from './text-suggestion';
import styles from './text-editing.module.css';

export function viewerRegionStyle(
  layout: ViewerTextLayout,
  field: 'primary' | 'secondary',
): React.CSSProperties | undefined {
  const region = layout[field];
  if (!region) return;
  const { bounds, style } = region;
  return {
    position: 'absolute',
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    minHeight: bounds.height,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    lineHeight: `${style.lineHeight}px`,
    letterSpacing: style.letterSpacing,
    color: style.color,
    textAlign: style.textAlign,
    textTransform: style.textTransform,
    WebkitTextStroke: style.WebkitTextStroke,
  };
}
export function ViewerTextEditor(props: ViewerTextEditorProps) {
  if (!props.active || props.clip.kind !== 'text' || !props.clip.text)
    return null;
  return <ActiveViewerTextEditor key={props.clip.id} {...props} />;
}
function ActiveViewerTextEditor({
  editing,
  clip,
  layout,
  onTransientHide,
  onFinish,
  restoreFocusRef,
  onEditIntent,
}: ViewerTextEditorProps) {
  const { model, value } = useTextModel(editing, clip.id);
  const root = React.useRef<HTMLDivElement>(null);
  const primary = React.useRef<HTMLDivElement>(null);
  const secondary = React.useRef<HTMLDivElement>(null);
  const composing = React.useRef(false);
  const ended = React.useRef(false);
  const deferredFinish = React.useRef<'commit' | 'cancel' | 'removed' | null>(
    null,
  );
  const [closed, setClosed] = React.useState(false);
  const callbacks = React.useRef({
    onTransientHide,
    onFinish,
    restoreFocusRef,
  });
  callbacks.current = { onTransientHide, onFinish, restoreFocusRef };
  const ready =
    layout.status === 'ready' && layout.displayScale > 0 && !clip.locked;
  const hidden = React.useRef(false);
  const previousFocus = React.useRef<HTMLElement | null>(null);
  const finish = React.useCallback(
    (reason: 'commit' | 'cancel' | 'removed') => {
      if (ended.current) return;
      if (composing.current && reason !== 'removed') {
        deferredFinish.current = reason;
        return;
      }
      ended.current = true;
      if (reason === 'commit') model.commit();
      else model.cancel();
      if (hidden.current) {
        callbacks.current.onTransientHide(clip.id, false);
        hidden.current = false;
      }
      setClosed(true);
      (
        callbacks.current.restoreFocusRef?.current ?? previousFocus.current
      )?.focus({ preventScroll: true });
      callbacks.current.onFinish?.(reason);
    },
    [model, clip.id],
  );
  React.useLayoutEffect(() => {
    if (!ready || ended.current || !primary.current) return;
    model.start('viewer');
    if (!model.getSnapshot().active) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    callbacks.current.onTransientHide(clip.id, true);
    hidden.current = true;
    primary.current.textContent = model.getSnapshot().content;
    if (secondary.current)
      secondary.current.textContent = model.getSnapshot().secondaryContent;
    focusWithoutScroll(primary.current, true);
    return () => {
      if (hidden.current) {
        callbacks.current.onTransientHide(clip.id, false);
        hidden.current = false;
      }
      model.cancel();
      if (!ended.current)
        (
          callbacks.current.restoreFocusRef?.current ?? previousFocus.current
        )?.focus({ preventScroll: true });
    };
  }, [ready, clip.id, model]);
  React.useLayoutEffect(() => {
    // Do not replace DOM on ordinary input/preview echoes: preserves native caret/range/IME.
    if (composing.current) return;
    for (const [element, text] of [
      [primary.current, value.content],
      [secondary.current, value.secondaryContent],
    ] as const)
      if (element && editableText(element) !== text) element.textContent = text;
  }, [value.content, value.secondaryContent, ready]);
  React.useEffect(() => {
    if (value.removed) finish('removed');
  }, [value.removed, finish]);
  React.useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        finish('commit');
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [finish]);
  if (closed || value.removed) return null;
  const editor = (
    field: 'content' | 'secondaryContent',
    ref: React.RefObject<HTMLDivElement | null>,
    region: 'primary' | 'secondary',
  ) => (
    <div
      ref={ref}
      role="textbox"
      aria-label={
        field === 'content' ? 'viewer text content' : 'viewer secondary text'
      }
      aria-multiline="true"
      aria-readonly={!ready}
      contentEditable={ready}
      suppressContentEditableWarning
      tabIndex={0}
      className={styles.viewerField}
      style={viewerRegionStyle(layout, region)}
      onFocus={() => model.start('viewer')}
      onInput={(event) =>
        model.change(field, editableText(event.currentTarget), 'viewer')
      }
      onCompositionStart={() => {
        composing.current = true;
        model.composition(true);
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        model.change(field, editableText(event.currentTarget), 'viewer');
        model.composition(false);
        if (deferredFinish.current) {
          const reason = deferredFinish.current;
          deferredFinish.current = null;
          finish(reason);
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        insertPlainText(
          event.currentTarget,
          event.clipboardData.getData('text/plain'),
        );
        model.change(field, editableText(event.currentTarget), 'viewer');
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
          finish('cancel');
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (isCaption(clip)) finish('commit');
          else {
            insertPlainText(event.currentTarget, '\n');
            model.change(field, editableText(event.currentTarget), 'viewer');
          }
        }
      }}
      onKeyUp={(event) => event.stopPropagation()}
    />
  );
  return (
    <div
      ref={root}
      className={styles.viewerHost}
      data-text-clip={clip.id}
      data-layout-status={layout.status}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        // Pointer outside and blur share the same idempotent close.
        finish('commit');
      }}
    >
      {ready ? (
        <div
          className={styles.viewerTransform}
          style={{
            left:
              layout.letterbox.x +
              (layout.sceneWidth * layout.displayScale) / 2,
            top:
              layout.letterbox.y +
              (layout.sceneHeight * layout.displayScale) / 2,
            transform: `scale(${layout.displayScale}) translate(${layout.transform.x}px, ${layout.transform.y}px) rotate(${layout.transform.rotation}deg) scale(${layout.transform.scale})`,
            opacity: layout.transform.opacity,
          }}
        >
          {editor('content', primary, 'primary')}
          {layout.secondary
            ? editor('secondaryContent', secondary, 'secondary')
            : null}
        </div>
      ) : (
        <p role="status" className={styles.pending}>
          text layout{' '}
          {layout.status === 'font-pending'
            ? 'waiting for font'
            : 'unavailable'}
        </p>
      )}
      <div className={styles.viewerSuggestion}>
        <TextSuggestion
          editing={editing}
          clipId={clip.id}
          restoreFocusRef={primary}
        />
      </div>
      {onEditIntent ? (
        <div className={styles.intents} aria-label="text transform tools">
          {(['move', 'scale', 'rotate'] as const).map((kind) => (
            <button
              type="button"
              key={kind}
              aria-label={`${kind} text`}
              onPointerDown={(event) => {
                event.stopPropagation();
                onEditIntent(event, clip.id, kind);
              }}
            >
              {kind}
            </button>
          ))}
        </div>
      ) : null}
      {value.error ? (
        <p role="alert" className={styles.error}>
          {value.error}
        </p>
      ) : null}
    </div>
  );
}
