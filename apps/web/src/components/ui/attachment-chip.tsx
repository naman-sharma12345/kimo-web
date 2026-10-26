'use client';
import * as React from 'react';
import { FileText, Play, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';
export interface AttachmentChipProps extends React.ComponentPropsWithoutRef<'div'> {
  name: string;
  meta: string;
  kind: 'video' | 'image' | 'audio' | 'doc';
  thumbnail?: string;
  progress?: number;
  onRemove?: () => void;
}
export const AttachmentChip = React.forwardRef<
  HTMLDivElement,
  AttachmentChipProps
>(function AttachmentChip(
  { name, meta, kind, thumbnail, progress, onRemove, className, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn('ui-attachment', className)} {...props}>
      <span className="ui-attachment-thumbnail" aria-hidden="true">
        {thumbnail && (kind === 'image' || kind === 'video') ? (
          <span
            className="ui-attachment-image"
            style={{ backgroundImage: `url(${JSON.stringify(thumbnail)})` }}
          />
        ) : kind === 'audio' ? (
          <span className="ui-waveform">
            {Array.from({ length: 12 }, (_, index) => (
              <i key={index} />
            ))}
          </span>
        ) : (
          <FileText />
        )}
        {kind === 'video' && <Play className="ui-attachment-play" />}
      </span>
      <span className="ui-attachment-copy">
        <span className="ui-attachment-name" title={name}>
          {name}
        </span>
        <span className="ui-attachment-meta">{meta}</span>
      </span>
      {onRemove && (
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={`remove ${name}`}
          tooltip={`remove ${name}`}
          className="ui-attachment-remove"
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </Button>
      )}
      {progress !== undefined && (
        <span
          role="progressbar"
          aria-label={`upload ${name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.max(0, progress))}
          className="ui-attachment-progress"
          data-complete={progress >= 100 || undefined}
          data-finished={progress >= 100 || undefined}
        >
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </span>
      )}
    </div>
  );
});
