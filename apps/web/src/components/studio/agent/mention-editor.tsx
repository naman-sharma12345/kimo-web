'use client';
import * as React from 'react';
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useId,
  useEffect,
} from 'react';
import type { KeyboardEvent } from 'react';
import {
  mentionQuery,
  readSegments,
  serializeSegments,
} from '@/lib/agent/composer-model';
import type { ComposerSegment, MentionClip } from '@/lib/agent/composer-model';
import styles from './mention-editor.module.css';
export type MentionEditorHandle = {
  focus(): void;
  prefill(text: string): void;
  clear(): void;
};
export type MentionEditorProps = {
  clips: readonly MentionClip[];
  placeholder: string;
  disabled?: boolean;
  onChange(segments: ComposerSegment[]): void;
  onSubmit(): void;
  onEscape?: () => void;
  parentHandlesModEnter?: boolean;
};
export const MentionEditor = forwardRef<
  MentionEditorHandle,
  MentionEditorProps
>(function MentionEditor(
  {
    clips,
    placeholder,
    disabled,
    onChange,
    onSubmit,
    onEscape,
    parentHandlesModEnter = true,
  },
  ref,
) {
  const root = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const queryRange = useRef<Range | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const option = list.current?.querySelector('[aria-selected="true"]');
    if (
      option instanceof HTMLElement &&
      typeof option.scrollIntoView === 'function'
    )
      option.scrollIntoView({ block: 'nearest' });
  }, [active, query]);
  const options =
    query === null
      ? []
      : clips.filter((clip) =>
          clip.name.toLowerCase().includes(query.toLowerCase()),
        );
  const sync = () => {
    const element = root.current;
    if (!element) return;
    onChange(readSegments(element));
    if (composing.current) return;
    const selection = window.getSelection();
    if (
      !selection?.rangeCount ||
      !selection.isCollapsed ||
      !element.contains(selection.anchorNode)
    ) {
      setQuery(null);
      return;
    }
    const range = selection.getRangeAt(0);
    // A query is confined to its current text node: never cross an atomic chip.
    if (range.startContainer.nodeType !== 3) {
      setQuery(null);
      return;
    }
    const before = (range.startContainer.textContent ?? '').slice(
      0,
      range.startOffset,
    );
    const match = mentionQuery(before);
    if (!match) {
      setQuery(null);
      return;
    }
    const replacement = range.cloneRange();
    replacement.setStart(range.startContainer, match.start);
    queryRange.current = replacement;
    setQuery(match.query);
    setActive(0);
  };
  const replaceText = (text: string) => {
    const element = root.current;
    if (!element) return;
    element.textContent = text;
    setQuery(null);
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    onChange(readSegments(element));
  };
  useImperativeHandle(ref, () => ({
    focus: () => root.current?.focus(),
    prefill: replaceText,
    clear: () => replaceText(''),
  }));
  const insert = (clip: MentionClip) => {
    const range = queryRange.current;
    const element = root.current;
    if (!range || !element || !element.contains(range.startContainer)) return;
    const chip = document.createElement('span');
    chip.setAttribute('contenteditable', 'false');
    chip.dataset.clipId = clip.id;
    chip.dataset.clipName = clip.name;
    chip.className = styles.chip ?? '';
    chip.textContent = clip.name;
    range.deleteContents();
    range.insertNode(chip);
    const space = document.createTextNode(' ');
    chip.after(space);
    range.setStart(space, 1);
    range.collapse(true);
    element.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    setQuery(null);
    onChange(readSegments(element));
  };
  const atomicDelete = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    const offset = range.startOffset;
    let neighbor: Node | null = null;
    if (node.nodeType === 3) {
      if (event.key === 'Backspace' && offset === 0)
        neighbor = node.previousSibling;
      if (event.key === 'Delete' && offset === (node.textContent?.length ?? 0))
        neighbor = node.nextSibling;
    } else
      neighbor =
        node.childNodes[event.key === 'Backspace' ? offset - 1 : offset] ??
        null;
    if (neighbor instanceof HTMLElement && neighbor.dataset.clipId) {
      event.preventDefault();
      neighbor.remove();
      sync();
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      composing.current ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    )
      return;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      if (!parentHandlesModEnter) {
        event.preventDefault();
        event.stopPropagation();
        onSubmit();
      }
      return;
    }
    if (query !== null) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setQuery(null);
        return;
      }
      if (
        options.length &&
        (event.key === 'ArrowDown' || event.key === 'ArrowUp')
      ) {
        event.preventDefault();
        setActive(
          (index) =>
            (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
            options.length,
        );
        return;
      }
      if (event.key === 'Enter' && options[active]) {
        event.preventDefault();
        insert(options[active]);
        return;
      }
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      onEscape?.();
    }
    atomicDelete(event);
  };
  return (
    <div className={styles.wrapper}>
      <div
        ref={root}
        className={styles.editor}
        role="textbox"
        aria-label="message kimo"
        aria-multiline="true"
        aria-disabled={disabled}
        aria-autocomplete="list"
        aria-controls={query !== null ? id : undefined}
        aria-activedescendant={
          query !== null && options[active] ? `${id}-${active}` : undefined
        }
        contentEditable={!disabled}
        suppressContentEditableWarning
        tabIndex={0}
        data-placeholder={placeholder}
        onInput={sync}
        onClick={sync}
        onKeyUp={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            sync();
        }}
        onKeyDown={keyDown}
        onCompositionStart={() => {
          composing.current = true;
          setQuery(null);
        }}
        onCompositionEnd={() => {
          composing.current = false;
          sync();
        }}
        onPaste={(event) => {
          event.preventDefault();
          if (disabled) return;
          const selection = window.getSelection();
          if (
            !selection?.rangeCount ||
            !root.current?.contains(selection.anchorNode)
          )
            return;
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const text = document.createTextNode(
            event.clipboardData.getData('text/plain'),
          );
          range.insertNode(text);
          range.setStartAfter(text);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          sync();
        }}
      />
      {query !== null && (
        <div
          ref={list}
          id={id}
          role="listbox"
          aria-label="clips"
          className={styles.list}
        >
          {options.map((clip, index) => (
            <div
              key={clip.id}
              id={`${id}-${index}`}
              role="option"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  insert(clip);
                }
              }}
              aria-selected={index === active}
              className={styles.option}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(clip)}
            >
              {clip.thumbUrl && (
                <img src={clip.thumbUrl} alt="" className={styles.thumbnail} />
              )}
              <span>{clip.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
export { serializeSegments };
