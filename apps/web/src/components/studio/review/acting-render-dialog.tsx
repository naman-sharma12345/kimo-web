'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogActions,
} from '@/components/ui/dialog';

export interface ActingRenderDialogProps {
  open: boolean;
  currentGroupSummary: string | null;
  ready?: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onRenderNow: () => void;
  onLetFinish: () => void;
}
/** Emits intent only. Parent owns the existing socket's pause acknowledgement. */
export function ActingRenderDialog({
  open,
  currentGroupSummary,
  ready = true,
  pending = false,
  onOpenChange,
  onRenderNow,
  onLetFinish,
}: ActingRenderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogTitle>render now?</DialogTitle>
        <DialogDescription>
          {currentGroupSummary === null
            ? 'current group summary unavailable. you can render now or let it finish.'
            : `kimo is still working on: ${currentGroupSummary}. you can render now or let it finish.`}
        </DialogDescription>
        <DialogActions>
          <Button disabled={pending} onClick={onLetFinish}>
            let kimo finish
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            loading={pending}
            onClick={onRenderNow}
          >
            render now
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
