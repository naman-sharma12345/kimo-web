'use client';
import * as React from 'react';
import { Fragment, useState } from 'react';
import type { AgentState } from '@/lib/agent/types';
import { selectActions, type ActionFilter } from '@/lib/agent/selectors';
import type { OrangeOwner } from './chat-stream';
import { ActionStatus, actionDuration, useElapsed } from './action-group';
import styles from './presentation.module.css';
export type ActionsTableProps = {
  model: AgentState;
  clipNames?: Readonly<Record<string, string>>;
  orangeOwner: OrangeOwner;
  active?: boolean;
};
export function ActionsTable({
  model,
  clipNames,
  orangeOwner,
  active = true,
}: ActionsTableProps) {
  const [filter, setFilter] = useState<ActionFilter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string>();
  const now = useElapsed(active && !!model.foregroundActionId);
  const actions = selectActions(model, { filter }).filter(
    (action) =>
      !search.trim() ||
      [
        action.tool,
        action.title,
        action.target?.clipId,
        action.target?.trackId,
        action.target?.subjectLabel,
        clipNames?.[action.target?.clipId ?? ''],
      ]
        .join(' ')
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <section className={styles.audit} aria-label="action audit log">
      <div className={styles.filters}>
        <input
          aria-label="search actions"
          placeholder="search actions"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div role="group" aria-label="filter actions">
          {(['all', 'edits', 'ai models', 'failed'] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <div>
        {actions.map((action) => (
          <Fragment key={action.id}>
            <button
              type="button"
              className={`${styles.auditRow} ${orangeOwner === 'running' && model.foregroundActionId === action.id ? styles.running : ''}`}
              aria-expanded={expanded === action.id}
              onClick={() =>
                setExpanded(expanded === action.id ? undefined : action.id)
              }
            >
              <time className={styles.mono}>
                {new Date(action.receivedAtMs).toLocaleTimeString([], {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </time>
              <ActionStatus action={action} active={active} />
              <span className={styles.tool}>{action.tool}</span>
              <span className={styles.target}>
                {clipNames?.[action.target?.clipId ?? ''] ??
                  action.target?.clipId ??
                  action.target?.trackId ??
                  'no target'}
              </span>
              <span className={styles.mono}>{actionDuration(action, now)}</span>
            </button>
            {expanded === action.id && (
              <div className={styles.details}>
                <pre aria-label={`arguments for ${action.tool}`}>
                  {JSON.stringify(action.args, null, 2)}
                </pre>
                <p>
                  {action.resultSummary ??
                    action.error ??
                    (action.status === 'done' ? 'completed' : action.status)}
                </p>
              </div>
            )}
          </Fragment>
        ))}
      </div>
      {actions.length === 0 && (
        <p className={styles.muted}>no matching actions</p>
      )}
    </section>
  );
}
