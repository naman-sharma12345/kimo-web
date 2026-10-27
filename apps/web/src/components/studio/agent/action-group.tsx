'use client';
import * as React from 'react';
import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  LoaderCircle,
  X,
  Minus,
  Wrench,
} from 'lucide-react';
import type { AgentAction, ChatItem } from '@/lib/agent/types';
import type { AgentPresentationCallbacks, OrangeOwner } from './chat-stream';
import styles from './presentation.module.css';
export function ActionStatus({
  action,
  active = true,
}: {
  action: AgentAction;
  active?: boolean;
}) {
  const Icon =
    action.status === 'running'
      ? LoaderCircle
      : action.status === 'done'
        ? Check
        : action.status === 'failed'
          ? X
          : Minus;
  return (
    <span
      aria-label={action.status}
      className={action.status === 'failed' ? styles.failed : undefined}
    >
      <Icon
        aria-hidden="true"
        className={
          action.status === 'running' && active ? styles.spinner : undefined
        }
      />
    </span>
  );
}
export function useElapsed(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
export function actionDuration(action: AgentAction, now: number) {
  return `${(Math.max(0, action.durationMs ?? (action.status === 'running' ? now - action.receivedAtMs : 0)) / 1000).toFixed(1)}s`;
}
export type ActionGroupProps = Pick<
  AgentPresentationCallbacks,
  'onShow' | 'onRevert'
> & {
  item: Extract<ChatItem, { kind: 'action-group' }>;
  actions: readonly AgentAction[];
  foregroundActionId?: string;
  orangeOwner: OrangeOwner;
  active?: boolean;
};
export function ActionGroup({
  item,
  actions,
  foregroundActionId,
  orangeOwner,
  active = true,
  onShow,
  onRevert,
}: ActionGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState('');
  const completed = actions.filter((action) => action.status === 'done');
  const selectedAction =
    completed.find((action) => action.id === selected) ?? completed.at(-1);
  const running = actions.find(
    (action) => action.id === foregroundActionId && action.status === 'running',
  );
  const highlighted = orangeOwner === 'running' && !!running;
  const now = useElapsed(active && !!running);
  const summary = item.stoppedAdjusting
    ? 'stopped here, adjusting'
    : (actions[0]?.title ?? 'actions');
  return (
    <section
      className={`${styles.card} ${highlighted ? styles.running : ''}`}
      data-action-id={running?.id}
      data-clip-id={running?.target?.clipId}
    >
      <div className={styles.groupHeader}>
        <Wrench aria-hidden="true" />
        <button
          type="button"
          className={styles.expand}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {item.responseToNote ? '↪ ' : ''}
          {summary}
          <ChevronDown aria-hidden="true" />
        </button>
        <span className={styles.mono}>
          {running
            ? actionDuration(running, now)
            : `${(actions.reduce((sum, a) => sum + (a.durationMs ?? 0), 0) / 1000).toFixed(1)}s`}
        </span>
      </div>
      {selectedAction && (
        <div className={styles.revert}>
          <label>
            step to revert
            <select
              aria-label="step to revert"
              value={selectedAction.id}
              onChange={(event) => setSelected(event.target.value)}
            >
              {completed.map((action) => (
                <option key={action.id} value={action.id}>
                  {action.title}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => onRevert(selectedAction.id)}>
            revert this step
          </button>
        </div>
      )}
      <ul className={styles.steps}>
        {(expanded ? actions : actions.slice(-3)).map((action) => (
          <li
            key={action.id}
            className={
              highlighted && action.id === running?.id
                ? styles.runningLine
                : undefined
            }
          >
            <ActionStatus action={action} active={active} />
            <span>
              {action.title}
              {action.note ? ` · ${action.note}` : ''}
            </span>
            <button
              type="button"
              className={styles.show}
              onClick={() => onShow(action.id)}
            >
              show
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
