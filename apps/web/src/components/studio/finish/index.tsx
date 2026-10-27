'use client';
import * as React from 'react';
import { Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  matchesQuery,
  serializeSrt,
  type FinishCommand,
  type LocalCut,
  type LocalStorage,
  type CaptionCue,
  type ExportSelection,
  type ExportCapabilities,
} from '@/lib/studio-finish';
import styles from './finish.module.css';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  commands: readonly FinishCommand[];
  clips: readonly { id: string; name: string }[];
  recentPrompts: readonly string[];
  onSelectClip(id: string): void;
  onPrompt(text: string): void;
}
export function CommandPalette({
  open,
  onOpenChange,
  commands,
  clips,
  recentPrompts,
  onSelectClip,
  onPrompt,
}: CommandPaletteProps) {
  const [query, setQuery] = React.useState('');
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setQuery('');
      setError('');
    }
  }, [open]);
  const run = (action: () => void) => {
    try {
      action();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'command unavailable');
    }
  };
  const results = [
    ...commands
      .filter((command) => matchesQuery(command.label, query))
      .map((command) => ({
        key: `action:${command.id}`,
        label: command.label,
        reason: command.disabledReason,
        action: command.run,
      })),
    ...clips
      .filter((clip) => matchesQuery(clip.name, query))
      .map((clip) => ({
        key: `clip:${clip.id}`,
        label: `clip · ${clip.name}`,
        reason: undefined,
        action: () => onSelectClip(clip.id),
      })),
    ...recentPrompts
      .filter((prompt) => matchesQuery(prompt, query))
      .map((prompt, index) => ({
        key: `prompt:${index}`,
        label: `prompt · ${prompt}`,
        reason: undefined,
        action: () => onPrompt(prompt),
      })),
  ];
  const rows = React.useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          const buttons = [
            ...(rows.current?.querySelectorAll<HTMLButtonElement>(
              'button:not(:disabled)',
            ) ?? []),
          ];
          if (!buttons.length) return;
          event.preventDefault();
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
              buttons.length
          ]?.focus();
        }}
      >
        <DialogTitle>command palette</DialogTitle>
        <DialogDescription>
          search actions, clips, and recent prompts on this device
        </DialogDescription>
        <input
          className={styles.input}
          aria-label="search commands"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div ref={rows} className={styles.results}>
          {results.map((item) => (
            <Button
              key={item.key}
              variant="ghost"
              disabled={!!item.reason}
              title={item.reason ?? item.label}
              onClick={() => run(item.action)}
            >
              {item.label}
              {item.reason ? ` · ${item.reason}` : ''}
            </Button>
          ))}
          {!results.length && <p role="status">no results</p>}
        </div>
        {error && <p role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
export function CutsMenu({
  cuts,
  selectedId,
  onSelect,
  onExit,
}: {
  cuts: readonly LocalCut[];
  selectedId: string | null;
  onSelect(id: string): void;
  onExit(): void;
}) {
  return (
    <label className={styles.control}>
      cuts on this device
      <select
        aria-label="cuts on this device"
        value={selectedId ?? ''}
        onChange={(event) =>
          event.target.value ? onSelect(event.target.value) : onExit()
        }
      >
        <option value="">current edit</option>
        {cuts.map((cut) => (
          <option key={cut.id} value={cut.id}>
            {cut.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function CutPreviewBanner({
  cut,
  onExit,
  onRestore,
  restoreDisabledReason,
}: {
  cut: LocalCut;
  onExit(): void;
  onRestore?(): void;
  restoreDisabledReason?: string;
}) {
  return (
    <section className={styles.banner} aria-label="read-only cut preview">
      <span>viewing {cut.label} · </span>
      <Button
        variant="ghost"
        disabled={!onRestore || !!restoreDisabledReason}
        title={
          restoreDisabledReason ??
          (!onRestore
            ? 'restoring cuts requires producer support and permission'
            : undefined)
        }
        onClick={onRestore}
      >
        restore this cut
      </Button>
      <span>read-only · on this device</span>
      <Button variant="ghost" onClick={onExit}>
        back to current edit
      </Button>
    </section>
  );
}
export function CompareControl({
  cutLabel,
  capability,
  value,
  onChange,
  onEnable,
}: {
  cutLabel: string;
  capability: { available: false; reason: string } | { available: true };
  value: number;
  onChange(value: number): void;
  onEnable(): void;
}) {
  return (
    <div className={styles.control}>
      <Button
        variant="ghost"
        disabled={!capability.available}
        onClick={onEnable}
      >
        compare with {cutLabel}
      </Button>
      {capability.available ? (
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          aria-label="comparison split"
          onChange={(event) => onChange(Number(event.target.value))}
        />
      ) : (
        <span role="status">{capability.reason}</span>
      )}
    </div>
  );
}
export function BeatToggle({
  available,
  enabled,
  onChange,
  reason,
}: {
  available: boolean;
  enabled: boolean;
  onChange(value: boolean): void;
  reason?: string;
}) {
  return (
    <Button
      variant="ghost"
      aria-label="snap to beats"
      aria-pressed={available && enabled}
      disabled={!available}
      title={
        reason ??
        (!available ? 'detected music beats are unavailable' : 'snap to beats')
      }
      onClick={() => onChange(!enabled)}
    >
      <Activity aria-hidden="true" />
    </Button>
  );
}
export function ExportOptions({
  value,
  onChange,
  capabilities,
  disabled = false,
}: {
  value: ExportSelection;
  onChange(value: ExportSelection): void;
  capabilities: ExportCapabilities;
  disabled?: boolean;
}) {
  return (
    <details className={styles.options}>
      <summary>more options</summary>
      <fieldset disabled={disabled}>
        <legend>requested export settings</legend>
        <label className={styles.control}>
          resolution
          <select
            aria-label="resolution"
            value={value.resolution}
            onChange={(event) => {
              if (event.target.value === '1080p' || capabilities.resolution720)
                onChange({
                  ...value,
                  resolution: event.target.value === '720p' ? '720p' : '1080p',
                });
            }}
          >
            <option>1080p</option>
            <option disabled={!capabilities.resolution720}>720p</option>
          </select>
        </label>
        <label className={styles.control}>
          format
          <select
            aria-label="format"
            value={value.format}
            onChange={(event) => {
              if (event.target.value === 'mp4' || capabilities.webm)
                onChange({
                  ...value,
                  format: event.target.value === 'webm' ? 'webm' : 'mp4',
                });
            }}
          >
            <option>mp4</option>
            <option disabled={!capabilities.webm}>webm</option>
          </select>
        </label>
        <label className={styles.control}>
          <input
            type="checkbox"
            checked={value.alsoPortrait}
            disabled={!capabilities.dualPortrait}
            onChange={(event) =>
              onChange({ ...value, alsoPortrait: event.target.checked })
            }
          />
          also export 9:16 version
        </label>
        {(!capabilities.resolution720 ||
          !capabilities.webm ||
          !capabilities.dualPortrait) && (
          <p>additional export options require producer support</p>
        )}
      </fieldset>
    </details>
  );
}
export function CaptionDownload({
  cues,
  title,
}: {
  cues: readonly CaptionCue[];
  title: string;
}) {
  const srt = serializeSrt(cues);
  const [error, setError] = React.useState('');
  const urls = React.useRef(new Set<string>());
  React.useEffect(
    () => () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current.clear();
    },
    [],
  );
  if (!srt) return null;
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          let url: string | undefined;
          try {
            url = URL.createObjectURL(
              new Blob([srt], { type: 'application/x-subrip;charset=utf-8' }),
            );
            urls.current.add(url);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${
              title
                .replace(/[\\/:*?"<>|]/gu, '')
                .split('')
                .filter((character) => character.charCodeAt(0) > 31)
                .join('')
                .trim() || 'captions'
            }.srt`;
            document.body.append(link);
            link.click();
            link.remove();
            const created = url;
            setTimeout(() => {
              URL.revokeObjectURL(created);
              urls.current.delete(created);
            }, 0);
            setError('');
          } catch {
            if (url) {
              URL.revokeObjectURL(url);
              urls.current.delete(url);
            }
            setError('captions download unavailable');
          }
        }}
      >
        download captions (.srt)
      </Button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
const coachSessionDismissed = new WeakSet<Window>();
export type CoachStep = 'agent' | 'viewer' | 'finish';
const coachSteps: readonly { id: CoachStep; text: string }[] = [
  { id: 'agent', text: 'talk to kimo here, even while it’s working' },
  { id: 'viewer', text: 'double-click any text to rewrite it' },
  { id: 'finish', text: 'render when you’re happy' },
];
export function ShortcutsCoachmarks({
  storage,
  anchors,
  onPrepareAnchor,
  onDismiss,
}: {
  storage?: LocalStorage;
  anchors: Record<CoachStep, HTMLElement | null>;
  onPrepareAnchor?(step: CoachStep): void;
  onDismiss?(): void;
}) {
  const [step, setStep] = React.useState<number | null>(null);
  const [position, setPosition] = React.useState<{
    left: number;
    top: number;
  } | null>(null);
  const bubble = React.useRef<HTMLElement>(null);
  const origin = React.useRef<HTMLElement | null>(null);
  const dismissed = React.useRef(false);
  React.useEffect(() => {
    origin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (coachSessionDismissed.has(window)) return;
    try {
      if (storage?.getItem('kimo-shortcuts-dismissed:v1') === 'true') return;
    } catch {
      /* Session only. */
    }
    if (!dismissed.current) setStep(0);
  }, [storage]);
  const current = step === null ? undefined : coachSteps[step];
  const anchor = current ? anchors[current.id] : null;
  const currentId = current?.id;
  React.useEffect(() => {
    if (currentId) onPrepareAnchor?.(currentId);
  }, [currentId, onPrepareAnchor]);
  React.useEffect(() => {
    if (!currentId) return;
    const place = () => {
      if (!anchor || !anchor.isConnected || !anchor.getClientRects().length) {
        setPosition(null);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const height = bubble.current?.getBoundingClientRect().height ?? 0;
      setPosition({
        left: Math.max(
          0,
          Math.min(
            rect.left,
            window.innerWidth -
              (bubble.current?.getBoundingClientRect().width ?? 0),
          ),
        ),
        top: Math.max(0, Math.min(rect.bottom, window.innerHeight - height)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, currentId]);
  React.useLayoutEffect(() => {
    const rect = bubble.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition((previous) => {
      if (!previous) return previous;
      const left = Math.max(
        0,
        Math.min(previous.left, window.innerWidth - rect.width),
      );
      const top = Math.max(
        0,
        Math.min(previous.top, window.innerHeight - rect.height),
      );
      return left === previous.left && top === previous.top
        ? previous
        : { left, top };
    });
  }, [currentId, !!position]);
  React.useEffect(() => {
    if (position)
      bubble.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [currentId, !!position]);
  const dismiss = () => {
    dismissed.current = true;
    coachSessionDismissed.add(window);
    setStep(null);
    try {
      storage?.setItem('kimo-shortcuts-dismissed:v1', 'true');
    } catch {
      /* Never crash the Studio. */
    }
    if (origin.current?.isConnected) origin.current.focus();
    onDismiss?.();
  };
  if (!current || !position) return null;
  return (
    <aside
      ref={bubble}
      role="dialog"
      aria-modal="false"
      aria-label="studio shortcuts onboarding"
      className={styles.coach}
      style={position}
    >
      <span className={styles.arrow} aria-hidden="true" />
      <p>{current.text}</p>
      <Button
        variant="ghost"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
          }
        }}
        onClick={() => (step === 2 ? dismiss() : setStep((step ?? 0) + 1))}
      >
        {step === 2 ? 'got it' : 'next'}
      </Button>
    </aside>
  );
}
