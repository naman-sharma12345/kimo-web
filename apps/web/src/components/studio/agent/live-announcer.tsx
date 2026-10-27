'use client';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import styles from './live-announcer.module.css';
export type LiveAnnouncerProps = {
  message?: { id: string; text: string };
  action?: { id: string; label: string } | null;
};
export const ANNOUNCEMENT_INTERVAL_MS = 3000;
export function LiveAnnouncer({ message, action }: LiveAnnouncerProps) {
  const [announcement, setAnnouncement] = useState('');
  const last = useRef<number | null>(null);
  const messages = useRef(new Set<string>());
  const previousAction = useRef('');
  const announcedAction = useRef<string | undefined>(undefined);
  const pending = useRef<{ text: string; actionId?: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const flush = () => {
      timer.current = undefined;
      const next = pending.current;
      pending.current = null;
      if (!next) return;
      last.current = Date.now();
      announcedAction.current = next.actionId;
      setAnnouncement(next.text);
    };
    if (pending.current?.actionId && pending.current.actionId !== action?.id)
      pending.current = null;
    if (announcedAction.current && announcedAction.current !== action?.id) {
      announcedAction.current = undefined;
      setAnnouncement('');
    }
    const actionKey = action ? `${action.id}:${action.label}` : '';
    if (actionKey !== previousAction.current) {
      previousAction.current = actionKey;
      if (action)
        pending.current = {
          text: `kimo is ${action.label}`,
          actionId: action.id,
        };
    }
    if (message && !messages.current.has(message.id)) {
      messages.current.add(message.id);
      pending.current = { text: message.text };
    }
    if (pending.current) {
      const delay =
        last.current === null
          ? 0
          : Math.max(0, ANNOUNCEMENT_INTERVAL_MS - (Date.now() - last.current));
      if (delay === 0) flush();
      else timer.current = setTimeout(flush, delay);
    }
    return () => {
      clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, [action?.id, action?.label, message?.id, message?.text]);
  useEffect(
    () => () => {
      pending.current = null;
    },
    [],
  );
  return (
    <div className={styles.region} aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  );
}
