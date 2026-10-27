'use client';
import * as React from 'react';
import type { ChatItem } from '@/lib/agent/types';
import { Avatar } from '@/components/ui/avatar';
import { AttachmentChip } from '@/components/ui/attachment-chip';
import type { ChatStreamProps } from './chat-stream';
import { RichText, safeUrl } from './rich-text';
import { ActionGroup } from './action-group';
import { WebImages } from './web-images';
import { SamResult } from './sam-result';
import styles from './presentation.module.css';
export function MessageRow({
  item,
  ...props
}: ChatStreamProps & { item: ChatItem }) {
  const assets = { ...props.model.assets, ...props.assets };
  switch (item.kind) {
    case 'user':
      return (
        <article className={styles.user}>
          <div className={styles.bubble}>
            {item.attachments.map((asset) => (
              <AttachmentChip
                key={asset.id}
                name={asset.name}
                kind={asset.kind}
                meta={asset.kind}
                thumbnail={safeUrl(asset.thumbUrl, true)}
              />
            ))}
            <RichText text={item.text} />
          </div>
          <time
            className={styles.timestamp}
            dateTime={new Date(item.receivedAtMs).toISOString()}
          >
            {new Date(item.receivedAtMs).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </time>
          {item.interrupt && (
            <span className={styles.muted}>
              {item.interrupt === 'pending'
                ? 'kimo will read this after the current step'
                : '✓ read'}
            </span>
          )}
          {item.delivery !== 'accepted' && (
            <span className={styles.muted}>{item.delivery}</span>
          )}
        </article>
      );
    case 'say':
      return (
        <article
          className={`${styles.agent} ${!item.stream ? styles.fade : ''}`}
        >
          <Avatar />
          <RichText
            text={item.text}
            streaming={!!item.stream}
            active={props.active}
          />
        </article>
      );
    case 'action-group':
      return (
        <ActionGroup
          item={item}
          actions={item.actionIds.flatMap((id) =>
            props.model.actions[id] ? [props.model.actions[id]] : [],
          )}
          foregroundActionId={props.model.foregroundActionId}
          orangeOwner={props.orangeOwner}
          active={props.active}
          onShow={props.onShow}
          onRevert={props.onRevert}
        />
      );
    case 'system':
      return <p className={styles.system}>{item.text}</p>;
    case 'review':
      return (
        <section className={`${styles.card} ${styles.review}`}>
          <div className={styles.agent}>
            <Avatar />
            <RichText text={item.text} />
          </div>
          <div className={styles.buttons}>
            <button type="button" onClick={props.onPlayFromStart}>
              play from start
            </button>
            <button type="button" onClick={props.onFocusComposer}>
              ask for changes
            </button>
            <button
              type="button"
              className={
                props.orangeOwner === 'review' ? styles.primary : undefined
              }
              onClick={props.onRender}
            >
              looks good, render it
            </button>
          </div>
        </section>
      );
    case 'choice':
      return (
        <section className={styles.choice}>
          <div className={styles.agent}>
            <Avatar />
            <RichText text={item.text} />
          </div>
          {item.choices.slice(0, 4).map((choice, index) => (
            <button
              type="button"
              key={index}
              onClick={() => props.onSend(choice)}
            >
              {choice}
            </button>
          ))}
          <span className={styles.muted}>or type your own answer</span>
        </section>
      );
    case 'web-images':
      return (
        <WebImages
          assets={item.assetIds.flatMap((id) =>
            assets[id] ? [assets[id]] : [],
          )}
          onFeedback={props.onFeedback}
        />
      );
    case 'sam':
      return (
        <SamResult
          item={item}
          asset={assets[item.maskAssetId]}
          clipName={props.clipNames?.[item.clipId]}
          onViewMask={props.onViewMask}
        />
      );
    case 'error':
      return (
        <section className={`${styles.card} ${styles.error}`}>
          <p>{item.message}</p>
          {item.actionId && (
            <button
              type="button"
              onClick={() => {
                if (item.actionId) props.onRetry(item.actionId);
              }}
            >
              retry step
            </button>
          )}
        </section>
      );
  }
}
