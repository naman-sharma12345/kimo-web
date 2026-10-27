'use client';
import * as React from 'react';
import {
  Pencil,
  Pause,
  Play,
  Undo2,
  Redo2,
  PanelRight,
  PanelLeft,
  Maximize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogActions,
} from '@/components/ui/dialog';
import { BrandMark } from '@/components/landing/brand';
import { useStudio } from '@/stores/studio';
import type { SaveStatus } from '@/lib/editing/types';
import { IconButton } from './controls';
export interface StudioCommands {
  pauseAgent: () => void;
  fullscreen: () => void;
  finish?: () => void;
  undo?: () => void;
  redo?: () => void;
}
export function StudioTopBar({
  sessionId,
  commands,
  togglePanel,
  onLeave,
  projectSave,
  projectTitle,
  onTitleChange,
  readOnly = false,
  projectActions,
}: {
  sessionId: string;
  commands: StudioCommands;
  togglePanel: (panel: 'agent' | 'inspector') => void;
  onLeave: () => void;
  projectSave?: SaveStatus;
  projectTitle?: string;
  onTitleChange?: (title: string) => void;
  readOnly?: boolean;
  projectActions?: React.ReactNode;
}) {
  const state = useStudio();
  const [localTitle, setLocalTitle] = React.useState('untitled video');
  const title = projectTitle ?? localTitle;
  const [draft, setDraft] = React.useState(title);
  const [editing, setEditing] = React.useState(false);
  const [leave, setLeave] = React.useState(false);
  const [save, setSave] = React.useState<
    | 'saved'
    | 'saving…'
    | 'offline · changes kept locally'
    | 'unsaved · browser storage unavailable'
  >('saved');
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(`kimo-studio-title:v1:${sessionId}`);
      setLocalTitle(stored || 'untitled video');
    } catch {
      /* In-memory fallback. */
    }
    const online = () =>
      setSave(navigator.onLine ? 'saved' : 'offline · changes kept locally');
    online();
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
    };
  }, [sessionId]);
  function saveTitle() {
    const value = draft.trim() || 'untitled video';
    setLocalTitle(value);
    onTitleChange?.(value);
    setEditing(false);
    setSave('saving…');
    try {
      localStorage.setItem(`kimo-studio-title:v1:${sessionId}`, value);
      setSave(navigator.onLine ? 'saved' : 'offline · changes kept locally');
    } catch {
      setSave('unsaved · browser storage unavailable');
    }
  }
  const projectSaveLabel =
    projectSave && projectSave !== 'saved'
      ? (
          {
            draft: 'editing…',
            pending: 'saving…',
            offline: 'offline · changes kept locally',
            unknown: 'save status unknown',
            unsaved: 'unsaved · browser storage unavailable',
            disposed: 'not connected',
          } as const
        )[projectSave]
      : undefined;
  const saveLabel = projectSaveLabel ?? save;
  const label =
    state.agentLabel ||
    {
      acting: 'kimo is editing',
      thinking: 'kimo is thinking',
      waiting_user: 'waiting for you',
      paused: 'paused',
      idle: 'waiting for you',
    }[state.agent];
  return (
    <>
      <header className="studio-topbar" data-testid="studio-topbar">
        <div className="studio-top-left">
          <a
            href="/"
            aria-label="kimo home"
            className="studio-mark"
            onClick={(e) => {
              e.preventDefault();
              setLeave(true);
            }}
          >
            <BrandMark />
          </a>
          <i className="studio-divider" />
          {editing ? (
            <input
              ref={(node) => {
                node?.focus();
              }}
              className="studio-title-input"
              aria-label="project title"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveTitle();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
            />
          ) : (
            <h1 className="studio-project-title">
              <button
                disabled={readOnly}
                onClick={() => {
                  setDraft(title);
                  setEditing(true);
                }}
              >
                {title}
                <Pencil aria-hidden="true" />
              </button>
            </h1>
          )}
          {projectActions}
          <span
            className="studio-save"
            data-offline={saveLabel.startsWith('offline') || undefined}
            title="project title saved on this device; project ops use the session API"
          >
            {saveLabel}
          </span>
        </div>
        <div className="studio-top-center">
          <button
            className="studio-agent-status"
            data-action-id={state.activeAction?.id}
            data-clip-id={state.activeAction?.target?.clipId}
            aria-label={label}
            onClick={() => {
              if (state.agentCollapsed) togglePanel('agent');
            }}
          >
            <Pill
              variant="live"
              active={state.agent === 'acting' || state.agent === 'thinking'}
              className="studio-status-pill"
              data-agent={state.agent}
            >
              {label}
              {state.agent === 'acting' && (
                <span className="mono">
                  {' '}
                  · {state.actionIds.length} actions
                </span>
              )}
            </Pill>
          </button>
          <IconButton
            icon={state.agent === 'paused' ? Play : Pause}
            label={
              state.agent === 'paused' ? 'let kimo continue' : 'pause kimo'
            }
            disabled={state.connection !== 'connected'}
            onClick={commands.pauseAgent}
          />
        </div>
        <div className="studio-top-right">
          <span className="studio-edit-actions">
            <IconButton
              icon={Undo2}
              label="undo (⌘Z)"
              disabled={!commands.undo}
              onClick={commands.undo}
            />
            <IconButton
              icon={Redo2}
              label="redo (⇧⌘Z)"
              disabled={!commands.redo}
              onClick={commands.redo}
            />
            <i className="studio-divider" />
          </span>
          <IconButton
            icon={PanelRight}
            label="toggle inspector"
            aria-pressed={!state.inspectorCollapsed}
            onClick={() => togglePanel('inspector')}
          />
          <IconButton
            icon={PanelLeft}
            label="toggle agent"
            aria-pressed={!state.agentCollapsed}
            onClick={() => togglePanel('agent')}
          />
          <Button
            className="studio-full-button"
            size="sm"
            onClick={commands.fullscreen}
          >
            <Maximize2 />
            preview full
          </Button>
          <Button
            size="sm"
            variant={state.actionIds.length ? 'primary' : 'secondary'}
            disabled={!state.actionIds.length}
            className="studio-finish"
            data-review={state.reviewRequested || undefined}
            onClick={commands.finish}
            title={
              commands.finish ? undefined : 'review flow available in Phase 9'
            }
          >
            finish
          </Button>
        </div>
      </header>
      <Dialog open={leave} onOpenChange={setLeave}>
        <DialogContent>
          <DialogTitle>leave the studio?</DialogTitle>
          <DialogDescription>
            your edit keeps its place for 24 hours.
          </DialogDescription>
          <DialogActions>
            <Button onClick={() => setLeave(false)}>stay</Button>
            <Button onClick={onLeave}>leave</Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </>
  );
}
