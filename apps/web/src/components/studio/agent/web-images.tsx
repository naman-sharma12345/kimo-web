'use client';
import * as React from 'react';
import { useRef, useState } from 'react';
import type { Asset } from '@kimo/client';
import * as Popover from '@radix-ui/react-popover';
import { Globe } from 'lucide-react';
import { safeUrl } from './rich-text';
import type { AgentPresentationCallbacks } from './chat-stream';
import styles from './presentation.module.css';
export function ResourceImage({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string>();
  const url = safeUrl(src, true);
  return url && failed !== url ? (
    <img
      src={url}
      alt={alt}
      className={className}
      onError={() => setFailed(url)}
    />
  ) : (
    <span>preview unavailable</span>
  );
}
function pageUrl(asset: Asset) {
  const url = safeUrl(asset.attribution?.pageUrl);
  return url && /^https?:/u.test(url) ? url : undefined;
}
function source(asset: Asset) {
  const url = pageUrl(asset);
  return url
    ? new URL(url).hostname
    : asset.attribution?.site || 'source unavailable';
}
export function WebImages({
  assets,
  onFeedback,
}: { assets: readonly Asset[] } & Pick<
  AgentPresentationCallbacks,
  'onFeedback'
>) {
  const [selected, setSelected] = useState<string>();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const asset = assets.find((item) => item.id === selected);
  const close = () => {
    setSelected(undefined);
    trigger.current?.focus();
  };
  return (
    <Popover.Root
      open={!!asset}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <section aria-label="web images" className={styles.web}>
        <Popover.Anchor asChild>
          <div className={styles.tiles}>
            {assets.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-label={`preview ${item.name} from ${source(item)}`}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setSelected(item.id);
                }}
              >
                <ResourceImage
                  src={item.thumbUrl ?? item.url}
                  alt={item.name}
                />
                <Globe aria-hidden="true" />
              </button>
            ))}
          </div>
        </Popover.Anchor>
        <p className={styles.muted}>
          from{' '}
          {[...new Set(assets.map(source))].join(', ') || 'source unavailable'}
        </p>
        {asset && (
          <Popover.Content
            aria-label={`image details: ${asset.name}`}
            className={styles.popover}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              trigger.current?.focus();
            }}
            onEscapeKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                close();
              }
            }}
          >
            <button type="button" onClick={close}>
              close preview
            </button>
            <ResourceImage
              className={styles.preview}
              src={asset.thumbUrl ?? asset.url}
              alt={asset.name}
            />
            {pageUrl(asset) ? (
              <a
                href={pageUrl(asset)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {source(asset)}
              </a>
            ) : (
              <p>source unavailable</p>
            )}
            <p>licence: {asset.attribution?.license || 'unknown'}</p>
            <div className={styles.buttons}>
              <button
                type="button"
                onClick={() => {
                  onFeedback(asset.id, 'use');
                  close();
                }}
              >
                use this
              </button>
              <button
                type="button"
                onClick={() => {
                  onFeedback(asset.id, 'reject');
                  close();
                }}
              >
                not this one
              </button>
            </div>
          </Popover.Content>
        )}
      </section>
    </Popover.Root>
  );
}
