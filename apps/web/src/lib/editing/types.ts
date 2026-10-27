import type { EditOutboxPersistence } from './persistence';
import type { Asset, KimoProject, Op, SessionSnapshot } from '@kimo/client';

export type EditSource =
  | 'timeline'
  | 'inspector'
  | 'viewer'
  | 'captions'
  | 'keyboard'
  | 'history'
  | 'assets';
export type EditResult = {
  id: string;
  status: 'acknowledged' | 'queued' | 'unknown' | 'failed' | 'cancelled';
  error?: string;
};
export type SaveStatus =
  | 'saved'
  | 'draft'
  | 'pending'
  | 'offline'
  | 'unknown'
  | 'unsaved'
  | 'disposed';
export interface EditGroup {
  id: string;
  label: string;
  source: EditSource;
  ops: Op[];
  status: 'unsent' | 'sending' | 'unknown' | 'failed';
}
export interface AuthoritativeGroup {
  version: number;
  ops: Op[];
  actionId?: string;
  author?: 'user' | 'agent';
  clientMutationId?: string;
}
export interface EditHistoryEntry {
  id: string;
  label: string;
  author: 'user' | 'agent';
  actionId?: string;
  available: boolean;
}
export interface TextSuggestion {
  clipId: string;
  content: string;
  version: number;
  actionId?: string;
}
export type EditPersistenceStatus =
  'hydrating' | 'ready' | 'locked' | 'unavailable' | 'unreadable' | 'disposed';
export interface EditReadiness {
  status: Exclude<EditPersistenceStatus, 'hydrating'>;
  error?: string;
}
export interface EditState {
  persistenceStatus: EditPersistenceStatus;
  persistencePending: boolean;
  editingEnabled: boolean;
  dispatchEnabled: boolean;
  project: KimoProject;
  acknowledged: KimoProject;
  acknowledgedVersion: number;
  assets: readonly Asset[];
  pending: readonly EditGroup[];
  draft: {
    id: string;
    clipIds: readonly string[];
    label: string;
    source: EditSource;
    ops: readonly Op[];
  } | null;
  saveStatus: SaveStatus;
  storageAvailable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  history: readonly EditHistoryEntry[];
  suggestions: readonly TextSuggestion[];
  error?: string;
}
/** Structural seams only: no UI, Studio, transport, GPU or socket imports. */
export interface EditContext {
  sessionId: string;
  project: KimoProject;
  assets?: readonly Asset[];
  client: {
    ops(
      sessionId: string,
      ops: Op[],
      baseVersion: number,
      options?: { signal?: AbortSignal; clientMutationId?: string },
    ): Promise<{ version: number }>;
    session(
      sessionId: string,
      options?: { signal?: AbortSignal },
    ): Promise<SessionSnapshot>;
  };
  notifications?: {
    toast(text: string, action?: { label: string; run: () => void }): void;
  };
  selectionRemoved?: (clipIds: readonly string[]) => void;
  projectChanged?: (project: KimoProject) => void;
  assetsChanged?: (assets: readonly Asset[]) => void;
  activity?: (text: string) => void;
  uploads?: { add(files: readonly File[]): Promise<void> };
  messages?: {
    send(text: string, attachments?: readonly string[]): Promise<void>;
    prefill(text: string): void;
  };
  persistence?: EditOutboxPersistence;
  /** Await a disposed in-process predecessor, never a foreign-tab takeover. */
  persistenceReadyAfter?: Promise<void>;
  /** Legacy migration input only. Never authorizes volatile dispatch. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  online?: () => boolean;
  makeId?: () => string;
  /** Opt in only after the server agrees to mutation identity; not idempotent replay authority. */
  mutationIdentity?: boolean;
}
export interface BeginEdit {
  clipIds: readonly string[];
  label: string;
  source: EditSource;
}
export interface EditingAPI {
  ready(): Promise<EditReadiness>;
  closed(): Promise<void>;
  getState(): EditState;
  subscribe(listener: (state: EditState) => void): () => void;
  beginEdit(input: BeginEdit): string;
  previewEdit(id: string, ops: readonly Op[]): void;
  commitEdit(id: string, ops?: readonly Op[]): Promise<EditResult>;
  cancelEdit(id: string): void;
  editGroup(
    ops: readonly Op[],
    label: string,
    source?: EditSource,
  ): Promise<EditResult>;
  undoUser(): Promise<EditResult>;
  redoUser(): Promise<EditResult>;
  revertAgentGroup(actionId: string): Promise<EditResult>;
  receiveAuthoritative(group: AuthoritativeGroup): Promise<void>;
  replaceSnapshot(snapshot: Pick<SessionSnapshot, 'project' | 'assets'>): void;
  resolveTextSuggestion(clipId: string, choice: 'use it' | 'keep mine'): void;
  flush(): Promise<void>;
  dispose(): void;
}
