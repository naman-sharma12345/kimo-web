'use client';
import * as React from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Asset } from '@kimo/client';
import type { AgentState } from '@/lib/agent/types';
import { MessageRow } from './message-row';
import styles from './presentation.module.css';
export type OrangeOwner = 'running' | 'review' | 'none';
export type AgentPresentationCallbacks = {
  onShow(actionId: string): void;
  onRevert(actionId: string): void;
  onViewMask(clipId: string, maskAssetId: string): void;
  onPlayFromStart(): void;
  onFocusComposer(): void;
  onRender(): void;
  onSend(text: string): void;
  onFeedback(assetId: string, feedback: 'use' | 'reject'): void;
  onRetry(actionId: string): void;
};
export type ChatStreamProps = AgentPresentationCallbacks & {
  model: AgentState;
  assets?: Readonly<Record<string, Asset>>;
  clipNames?: Readonly<Record<string, string>>;
  orangeOwner: OrangeOwner;
  active?: boolean;
};
export function ChatStream(props: ChatStreamProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [newActivity, setNewActivity] = useState(false);
  const active = props.active ?? true;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node || !active) return;
    const update = () => {
      if (pinned.current) node.scrollTop = node.scrollHeight;
      else setNewActivity(true);
    };
    update();
    const observer =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver((records) => {
            if (
              records.some((record) => {
                const target =
                  record.target.nodeType === 1
                    ? (record.target as Element)
                    : record.target.parentElement;
                return target?.closest(`.${styles.rich}`);
              })
            )
              update();
          });
    observer?.observe(node, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => observer?.disconnect();
  }, [props.model.items, props.model.actions, active]);
  return (
    <div className={styles.stream}>
      <div
        ref={viewport}
        className={styles.viewport}
        aria-label="conversation"
        onScroll={() => {
          const node = viewport.current;
          if (node) {
            pinned.current =
              node.scrollHeight - node.scrollTop - node.clientHeight <= 80;
            if (pinned.current) setNewActivity(false);
          }
        }}
      >
        {props.model.items.map((item) => (
          <MessageRow
            key={`${props.model.sessionId}:${item.id}`}
            {...props}
            active={active}
            item={item}
            orangeOwner={
              item.kind === 'review' &&
              item.id !==
                [...props.model.items]
                  .reverse()
                  .find((row) => row.kind === 'review')?.id
                ? 'none'
                : props.orangeOwner
            }
          />
        ))}
      </div>
      {newActivity && (
        <button
          type="button"
          className={styles.activity}
          onClick={() => {
            const node = viewport.current;
            if (node) {
              node.scrollTop = node.scrollHeight;
              pinned.current = true;
              setNewActivity(false);
            }
          }}
        >
          new activity ↓
        </button>
      )}
    </div>
  );
}
