'use client';
import * as React from 'react';
import { useRef, useState } from 'react';
import { Globe, Upload } from 'lucide-react';
import type { Asset } from '@kimo/client';
import type { TimelineEditorProps } from './types';
import styles from './timeline.module.css';
export const ASSET_DRAG_TYPE = 'application/x-kimo-asset';
export function AssetsDrawer({
  assets,
  onUpload,
  onInsert,
  onError,
}: Pick<TimelineEditorProps, 'assets' | 'onUpload' | 'onError'> & {
  onInsert: (asset: Asset) => void;
}) {
  const [tab, setTab] = useState<'user' | 'web'>('user');
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className={styles.drawer} aria-label="assets">
      <div className={styles.tabs} role="tablist" aria-label="asset sources">
        {(['user', 'web'] as const).map((source) => (
          <button
            key={source}
            type="button"
            role="tab"
            aria-selected={tab === source}
            aria-controls="timeline-assets-grid"
            id={`timeline-assets-${source}`}
            onClick={() => setTab(source)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                setTab(source === 'user' ? 'web' : 'user');
                const sibling =
                  e.currentTarget.parentElement?.querySelectorAll('button')[
                    source === 'user' ? 1 : 0
                  ];
                sibling?.focus();
              }
            }}
          >
            {source === 'user' ? 'your files' : 'found by kimo'}
          </button>
        ))}
      </div>
      <div
        id="timeline-assets-grid"
        role="tabpanel"
        aria-labelledby={`timeline-assets-${tab}`}
        className={styles.assetGrid}
      >
        <button
          type="button"
          className={styles.asset}
          disabled={!onUpload}
          onClick={() => input.current?.click()}
        >
          <span className={styles.assetThumb}>
            <Upload size={16} />
          </span>
          upload more
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label="upload more"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
            if (files.length)
              void Promise.resolve(onUpload?.(files)).catch((error: unknown) =>
                onError?.(
                  error instanceof Error ? error.message : 'Upload unavailable',
                ),
              );
          }}
        />
        {assets
          .filter((asset) => asset.source === tab)
          .map((asset) => (
            <button
              type="button"
              key={asset.id}
              className={styles.asset}
              draggable={asset.kind !== 'doc'}
              disabled={asset.kind === 'doc'}
              aria-label={`add ${asset.name} at playhead`}
              title={
                asset.attribution
                  ? `found on ${asset.attribution.site}${asset.attribution.license ? ` · ${asset.attribution.license}` : ''}`
                  : asset.name
              }
              onDragStart={(e) => {
                e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onInsert(asset)}
            >
              <span className={styles.assetThumb}>
                {asset.thumbUrl ? (
                  <img src={asset.thumbUrl} alt="" draggable={false} />
                ) : null}
                {asset.source === 'web' ? (
                  <Globe
                    size={12}
                    aria-label={asset.attribution?.site ?? 'web source'}
                  />
                ) : null}
              </span>
              <span className={styles.assetName}>{asset.name}</span>
            </button>
          ))}
      </div>
    </section>
  );
}
