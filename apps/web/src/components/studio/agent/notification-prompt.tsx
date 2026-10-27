'use client';
import * as React from 'react';
import { useSyncExternalStore } from 'react';
import type { AgentNotificationController } from '@/lib/agent/notifications';
import styles from './notification-prompt.module.css';
export function NotificationPrompt({
  controller,
}: {
  controller: AgentNotificationController;
}) {
  const visible = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    () => false,
  );
  if (!visible) return null;
  return (
    <section aria-label="notifications" className={styles.prompt}>
      <p>want a ping when kimo needs you?</p>
      <div>
        <button
          type="button"
          onClick={() => {
            void controller.answer('yes');
          }}
        >
          yes
        </button>
        <button
          type="button"
          onClick={() => {
            void controller.answer('no thanks');
          }}
        >
          no thanks
        </button>
      </div>
    </section>
  );
}
