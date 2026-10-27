'use client';
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogActions,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Row } from '@/components/ui/row';
import { Kbd } from '@/components/ui/kbd';
import { studioShortcuts } from '@/lib/keyboard';
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="studio-shortcuts">
        <DialogTitle>keyboard shortcuts</DialogTitle>
        <DialogDescription>
          editing commands connect in Phase 7; playback connects in Phase 6.
        </DialogDescription>
        <div className="studio-shortcut-columns">
          {studioShortcuts.map((shortcut) => (
            <Row
              key={shortcut.id}
              dense
              label={shortcut.label}
              value={
                <span className="studio-kbd-group">
                  {shortcut.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              }
            />
          ))}
        </div>
        <DialogActions>
          <Button onClick={() => onOpenChange(false)}>close</Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
