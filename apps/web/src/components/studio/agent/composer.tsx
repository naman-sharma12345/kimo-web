'use client';
import * as React from 'react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { MentionEditor } from './mention-editor';
import type { MentionEditorHandle } from './mention-editor';
import { serializeSegments, slashCommand } from '@/lib/agent/composer-model';
import type {
  ComposerAttachment,
  ComposerSegment,
  MentionClip,
  SendInput,
} from '@/lib/agent/composer-model';
import styles from './composer.module.css';
export type AgentComposerHandle = {
  focus(): void;
  prefill(text: string): void;
  submit(): void;
};
export type AgentComposerProps = {
  clips: readonly MentionClip[];
  attachments?: readonly ComposerAttachment[];
  onSend(input: SendInput): void | Promise<void>;
  onUpload?: (files: readonly File[]) => void | Promise<void>;
  onRemoveAttachment?: (id: string) => void;
  onPause: () => void | Promise<void>;
  onResume: () => void | Promise<void>;
  onUndoLast: () => unknown | Promise<unknown>;
  onRender: () => void | Promise<void>;
  onStatus?: (message: string) => void;
  working?: boolean;
  stopped?: boolean;
  disabled?: boolean;
  orangeOwner?: 'composer' | 'other' | 'none';
  parentHandlesModEnter?: boolean;
  onEscape?: () => void;
};
export const AgentComposer = forwardRef<
  AgentComposerHandle,
  AgentComposerProps
>(function AgentComposer(
  {
    clips,
    attachments = [],
    onSend,
    onUpload,
    onRemoveAttachment,
    onPause,
    onResume,
    onUndoLast,
    onRender,
    onStatus,
    working = false,
    stopped = false,
    disabled = false,
    orangeOwner = 'none',
    parentHandlesModEnter = true,
    onEscape,
  },
  ref,
) {
  const editor = useRef<MentionEditorHandle>(null);
  const segments = useRef<ComposerSegment[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const revision = useRef(0);
  const [error, setError] = useState('');
  const unresolved = attachments.some(
    (attachment) => attachment.status !== 'ready',
  );
  const available =
    !disabled &&
    !busy &&
    !unresolved &&
    (text.trim().length > 0 || attachments.length > 0);
  const submit = async () => {
    if (lock.current || disabled || unresolved) return;
    const value = serializeSegments(segments.current);
    if (!value.trim() && !attachments.length) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const sentRevision = revision.current;
    try {
      const command = attachments.length ? undefined : slashCommand(value);
      if (command === 'pause') await onPause();
      else if (command === 'resume') await onResume();
      else if (command === 'undo-last') await onUndoLast();
      else if (command === 'render') await onRender();
      else
        await onSend({
          text: value,
          ...(attachments.length
            ? {
                attachmentIds: attachments.map(
                  (attachment) => attachment.asset?.id ?? attachment.id,
                ),
              }
            : {}),
        });
      // A later user edit must never be cleared by an older async completion.
      if (revision.current === sentRevision) editor.current?.clear();
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : 'could not send';
      setError(message);
      onStatus?.(message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  useImperativeHandle(ref, () => ({
    focus: () => editor.current?.focus(),
    prefill: (value) => editor.current?.prefill(value),
    submit: () => {
      void submit();
    },
  }));
  return (
    <div className={styles.composer} aria-busy={busy} data-working={working}>
      {attachments.length > 0 && (
        <ul className={styles.attachments} aria-label="attachments">
          {attachments.map((attachment) => (
            <li key={attachment.id} className={styles.attachment}>
              {attachment.asset?.thumbUrl && (
                <img
                  src={attachment.asset.thumbUrl}
                  alt=""
                  className={styles.thumbnail}
                />
              )}
              <span>{attachment.asset?.name ?? attachment.name}</span>
              {attachment.status === 'uploading' && (
                <progress
                  aria-label={`uploading ${attachment.name}`}
                  max={100}
                  value={
                    attachment.progress === undefined
                      ? undefined
                      : Math.max(0, Math.min(100, attachment.progress))
                  }
                />
              )}
              <span className={styles.status}>
                {attachment.status === 'ready'
                  ? 'uploaded'
                  : attachment.status === 'failed'
                    ? 'upload failed'
                    : 'uploading'}
              </span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemoveAttachment(attachment.id)}
                  aria-label={`remove ${attachment.name}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {working && !stopped && (
        <p className={styles.hint}>
          kimo will stop after the current step and read your note
        </p>
      )}
      <MentionEditor
        ref={editor}
        clips={clips}
        disabled={disabled}
        placeholder={
          stopped
            ? 'tell kimo what to do next…'
            : working
              ? 'type to interrupt kimo…'
              : 'tell kimo what to change…'
        }
        onChange={(value) => {
          segments.current = value;
          revision.current++;
          setText(serializeSegments(value));
        }}
        onSubmit={() => {
          void submit();
        }}
        onEscape={onEscape}
        parentHandlesModEnter={parentHandlesModEnter}
      />
      <div className={styles.controls}>
        {onUpload && (
          <label className={styles.upload}>
            attach files
            <input
              type="file"
              multiple
              aria-label="attach files"
              disabled={disabled || busy}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                if (files.length)
                  void Promise.resolve()
                    .then(() => onUpload(files))
                    .catch((cause: unknown) => {
                      const message =
                        cause instanceof Error
                          ? cause.message
                          : 'could not upload';
                      setError(message);
                      onStatus?.(message);
                    });
              }}
            />
          </label>
        )}
        <button
          type="button"
          className={styles.send}
          data-primary={orangeOwner === 'composer' && !working}
          disabled={!available}
          onClick={() => {
            void submit();
          }}
        >
          send
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
});
