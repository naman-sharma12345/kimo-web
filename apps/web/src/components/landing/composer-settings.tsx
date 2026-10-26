'use client';
import * as React from 'react';
import { useId, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import type { SessionRequest } from '@kimo/client';
export type Aspect = SessionRequest['aspect'];
const aspects: Aspect[] = ['auto', '16:9', '9:16', '1:1'];
export function AspectFrame({ aspect }: { aspect: Aspect }) {
  return (
    <svg
      className="aspect-frame"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x={aspect === '9:16' ? 4.5 : 1}
        y={aspect === '16:9' ? 4.5 : 1}
        width={aspect === '9:16' ? 7 : 14}
        height={aspect === '16:9' ? 7 : 14}
        rx="2"
        stroke="currentColor"
      />
    </svg>
  );
}
interface SettingsProps {
  aspect: Aspect;
  setAspect: (value: Aspect) => void;
  duration: number | undefined;
  setDuration: (value: number | undefined) => void;
}
function SettingsControls({
  aspect,
  setAspect,
  duration,
  setDuration,
}: SettingsProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const inputId = useId();
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`aspect ratio: ${aspect}`}
          >
            <AspectFrame aspect={aspect} />
            {aspect}
          </Button>
        </MenuTrigger>
        <MenuContent>
          {aspects.map((value) => (
            <MenuItem
              key={value}
              icon={<AspectFrame aspect={value} />}
              onSelect={() => setAspect(value)}
            >
              {value}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        <Menu>
          <MenuTrigger asChild>
            <PopoverAnchor asChild>
              <Button variant="ghost" size="sm">
                {duration === undefined
                  ? 'any length'
                  : duration === 120
                    ? '2 min'
                    : `${duration}s`}
              </Button>
            </PopoverAnchor>
          </MenuTrigger>
          <MenuContent
            onCloseAutoFocus={(event) => {
              if (customOpen) event.preventDefault();
            }}
          >
            {[undefined, 15, 30, 60, 120].map((value) => (
              <MenuItem
                key={value ?? 'any'}
                onSelect={() => setDuration(value)}
              >
                {value === undefined
                  ? 'any length'
                  : value === 120
                    ? '2 min'
                    : `${value}s`}
              </MenuItem>
            ))}
            <MenuItem
              onSelect={() => {
                setCustomText(duration === undefined ? '' : String(duration));
                setCustomOpen(true);
              }}
            >
              custom…
            </MenuItem>
          </MenuContent>
        </Menu>
        <PopoverContent>
          <label htmlFor={inputId}>length in seconds</label>
          <Input
            id={inputId}
            type="number"
            min={1}
            value={customText}
            onChange={(event) => {
              setCustomText(event.target.value);
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value > 0) setDuration(value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setCustomOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
export function ComposerSettings(props: SettingsProps) {
  return (
    <>
      <div className="composer-desktop-settings">
        <SettingsControls {...props} />
      </div>
      <div className="composer-mobile-settings">
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              iconOnly
              aria-label="video settings"
              tooltip="video settings"
            >
              <SlidersHorizontal />
            </Button>
          </DialogTrigger>
          <DialogContent className="composer-settings-sheet">
            <DialogTitle>video settings</DialogTitle>
            <DialogDescription>aspect ratio and length</DialogDescription>
            <div className="composer-settings-controls">
              <SettingsControls {...props} />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
