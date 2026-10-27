'use client';
import * as React from 'react';
import type { Asset } from '@kimo/client';
import type { ChatItem } from '@/lib/agent/types';
import type { AgentPresentationCallbacks } from './chat-stream';
import { safeUrl } from './rich-text';
import styles from './presentation.module.css';
export function SamResult({
  item,
  asset,
  clipName,
  onViewMask,
}: {
  item: Extract<ChatItem, { kind: 'sam' }>;
  asset?: Asset;
  clipName?: string;
} & Pick<AgentPresentationCallbacks, 'onViewMask'>) {
  // Only an actual image mask resource is a decodable still. Never substitute the source clip or infer a subject.
  const preview =
    asset?.mask?.encoding === 'luma_image'
      ? safeUrl(asset.url, true)
      : undefined;
  return (
    <section className={styles.sam}>
      <div className={styles.mask}>
        <span className={styles.checker} aria-hidden="true">
          {Array.from({ length: 40 }, (_, index) => (
            <i
              key={index}
              className={
                (Math.floor(index / 8) + (index % 8)) % 2 === 0
                  ? styles.checkerLight
                  : undefined
              }
            />
          ))}
        </span>
        {preview ? (
          <img src={preview} alt="SAM mask resource" />
        ) : (
          <span>mask preview unavailable</span>
        )}
      </div>
      <div>
        <p>
          {item.subjectLabel
            ? `selected the ${item.subjectLabel}`
            : 'selection'}{' '}
          in {clipName ?? item.clipId} with sam 3.1
        </p>
        <button
          type="button"
          onClick={() => onViewMask(item.clipId, item.maskAssetId)}
        >
          view mask
        </button>
      </div>
    </section>
  );
}
