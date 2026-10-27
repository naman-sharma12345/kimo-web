'use client';
import * as React from 'react';
import type { Asset, KimoProject } from '@kimo/client';
import type { EditingAPI } from '@/lib/editing/types';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogActions,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { replaceMedia } from './replace-media';
export function ReplaceMediaDialog({
  clipId,
  mode,
  project,
  assets,
  editing,
  onClose,
  onUpload,
}: {
  clipId: string | null;
  mode: 'search' | 'upload' | 'all';
  project: KimoProject;
  assets: readonly Asset[];
  editing: EditingAPI | null;
  onClose(): void;
  onUpload(files: readonly File[]): Promise<readonly string[]>;
}) {
  const [error, setError] = React.useState(''),
    [busy, setBusy] = React.useState(false);
  const inFlight = React.useRef(false);
  const clip = clipId ? project.clips[clipId] : undefined;
  React.useEffect(() => {
    setError('');
    setBusy(false);
  }, [clipId]);
  const applyAsset = async (asset: Asset) => {
    if (!editing || !clipId) return;
    const result = await editing.editGroup(
      replaceMedia(
        editing.getState().project,
        clipId,
        asset,
        editing.getState().assets,
      ),
      'replace media',
      'assets',
    );
    if (result.status === 'failed' || result.status === 'unknown') {
      setError(result.error ?? 'replacement save is not confirmed');
      return;
    }
    onClose();
  };
  const choose = async (asset: Asset) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await applyAsset(asset);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const candidates = clip
    ? assets.filter(
        (asset) =>
          asset.kind === clip.kind &&
          !asset.mask &&
          !asset.lut &&
          (mode !== 'search' || asset.source === 'web'),
      )
    : [];
  return (
    <Dialog
      open={!!clipId}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>replace media…</DialogTitle>
        <DialogDescription>
          Choose a registered source of the same kind. Placement and styling are
          retained; source-specific masks are removed.
        </DialogDescription>
        {error ? <p role="alert">{error}</p> : null}
        {candidates.length ? (
          candidates.map((asset) => (
            <Button
              key={asset.id}
              variant="secondary"
              disabled={busy || clip?.locked}
              onClick={() => {
                void choose(asset).catch((error) =>
                  setError(
                    error instanceof Error
                      ? error.message
                      : 'replacement unavailable',
                  ),
                );
              }}
            >
              {asset.name}
            </Button>
          ))
        ) : (
          <p>No compatible registered sources are available.</p>
        )}
        <input
          type="file"
          aria-label="upload replacement media"
          disabled={busy || !clip || clip.locked}
          accept={
            clip?.kind === 'image'
              ? 'image/*'
              : clip?.kind === 'audio'
                ? 'audio/*'
                : 'video/*'
          }
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            if (!files.length || !editing || inFlight.current) return;
            inFlight.current = true;
            setBusy(true);
            setError('');
            void onUpload(files.slice(0, 1))
              .then(async (ids) => {
                const asset = editing
                  .getState()
                  .assets.find((asset) => asset.id === ids[0]);
                if (!asset)
                  throw new Error('uploaded replacement is not confirmed');
                await applyAsset(asset);
              })
              .catch((error) =>
                setError(
                  error instanceof Error
                    ? error.message
                    : 'replacement unavailable',
                ),
              )
              .finally(() => {
                inFlight.current = false;
                setBusy(false);
              });
          }}
        />
        <DialogActions>
          <Button disabled={busy} onClick={onClose}>
            cancel
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
