'use client';
import * as React from 'react';
import { Fragment, useEffect, useState } from 'react';
import styles from './presentation.module.css';
export function safeUrl(
  value: string | undefined,
  resource = false,
): string | undefined {
  if (
    !value ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
    ) ||
    value.includes('\\')
  )
    return undefined;
  if (resource && value.startsWith('/') && !value.startsWith('//'))
    return value;
  try {
    const url = new URL(value);
    return [
      'https:',
      'http:',
      ...(resource ? ['blob:'] : ['mailto:']),
    ].includes(url.protocol)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}
export function RichText({
  text,
  streaming = false,
  active = true,
}: {
  text: string;
  streaming?: boolean;
  active?: boolean;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(streaming && !reduced ? 0 : text.length);
  useEffect(() => {
    if (!streaming || reduced || !active) return;
    const timer = setInterval(
      () =>
        setShown((previous) => {
          if (previous >= text.length) {
            clearInterval(timer);
            return previous;
          }
          const next = /\S+\s*/u.exec(text.slice(previous));
          return next ? previous + next.index + next[0].length : text.length;
        }),
      40,
    );
    return () => clearInterval(timer);
  }, [text, streaming, reduced, active]);
  const visible = !streaming || reduced ? text : text.slice(0, shown);
  const parts = visible.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/gu);
  return (
    <span className={styles.rich}>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={index}>{part.slice(1, -1)}</code>;
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(part);
        if (link) {
          const href = safeUrl(link[2]);
          return href ? (
            <a
              key={index}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link[1]}
            </a>
          ) : (
            <Fragment key={index}>{link[1]}</Fragment>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </span>
  );
}
