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
          Shortcuts do not run while you are typing. Playback requires an
          available preview.
        </DialogDescription>
        <div className="studio-shortcut-columns">
          {studioShortcuts
            .filter(
              (shortcut, index, all) =>
                all.findIndex((item) => item.id === shortcut.id) === index,
            )
            .map((shortcut) => (
              <Row
                key={`${shortcut.id}:${shortcut.key}`}
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
