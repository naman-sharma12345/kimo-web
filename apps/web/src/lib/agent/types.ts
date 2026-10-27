import type { Asset, ServerEvent } from '@kimo/client';

export type ActionStart = Extract<ServerEvent, { t: 'agent.action.start' }>;
export type AgentAction = {
  id: string;
  groupId: string;
  tool: string;
  title: string;
  args: Readonly<Record<string, unknown>>;
  target?: ActionStart['target'];
  status: 'running' | 'done' | 'failed' | 'stopped';
  receivedAtMs: number;
  durationMs?: number;
  error?: string;
  resultSummary?: string;
  pct?: number;
  note?: string;
};
export type ChatItem =
  | {
      kind: 'user';
      id: string;
      text: string;
      attachments: readonly Asset[];
      receivedAtMs: number;
      delivery: 'sending' | 'accepted' | 'unknown' | 'failed';
      interrupt?: 'pending' | 'read';
    }
  | {
      kind: 'say';
      id: string;
      text: string;
      stream?: { sequence: number; done: boolean };
    }
  | {
      kind: 'action-group';
      id: string;
      actionIds: readonly string[];
      responseToNote: boolean;
      stoppedAdjusting: boolean;
    }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'review'; id: string; text: string }
  | { kind: 'choice'; id: string; text: string; choices: readonly string[] }
  | {
      kind: 'web-images';
      id: string;
      actionId?: string;
      assetIds: readonly string[];
    }
  | {
      kind: 'sam';
      id: string;
      actionId?: string;
      clipId: string;
      maskAssetId: string;
      subjectLabel?: string;
      coordinateSpace?: 'source_uv';
    }
  | { kind: 'error'; id: string; message: string; actionId?: string };
export type AgentReset = {
  sessionId: string;
  originalPrompt?: string;
  actionIds?: readonly string[];
  receivedAtMs?: number;
};
export type AgentState = {
  sessionId: string;
  items: readonly ChatItem[];
  actions: Readonly<Record<string, AgentAction>>;
  actionOrder: readonly string[];
  recordedActionIds: readonly string[];
  assets: Readonly<Record<string, Asset>>;
  foregroundActionId?: string;
  openGroupId?: string;
  responseToNote: boolean;
  status: Extract<ServerEvent, { t: 'agent.status' }> | null;
  connected: boolean | null;
  diagnostics: readonly string[];
};
export type UserItem = Extract<ChatItem, { kind: 'user' }>;
export type AgentModelEvent =
  | { type: 'reset'; input: AgentReset }
  | { type: 'receive'; event: ServerEvent; receivedAtMs: number }
  | { type: 'appendUser'; item: UserItem }
  | { type: 'markSend'; id: string; delivery: UserItem['delivery'] }
  | { type: 'appendSystem'; id: string; text: string }
  | { type: 'connectionChanged'; connected: boolean; id: string };
