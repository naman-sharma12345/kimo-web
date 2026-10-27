import type { ServerEvent } from '@kimo/client';
import type {
  AgentModelEvent,
  AgentReset,
  AgentState,
  ChatItem,
} from './types';

export function createAgentState(input: AgentReset): AgentState {
  return {
    sessionId: input.sessionId,
    items: input.originalPrompt
      ? [
          {
            kind: 'user',
            id: `original:${input.sessionId}`,
            text: input.originalPrompt,
            attachments: [],
            receivedAtMs: input.receivedAtMs ?? 0,
            delivery: 'accepted',
          },
        ]
      : [],
    actions: {},
    actionOrder: [],
    recordedActionIds: [...new Set(input.actionIds ?? [])],
    assets: {},
    responseToNote: false,
    status: null,
    connected: null,
    diagnostics: [],
  };
}
export const resetAgentState = createAgentState;
const diagnostic = (state: AgentState, text: string): AgentState => ({
  ...state,
  diagnostics: [...state.diagnostics.slice(-99), text],
});
function append(state: AgentState, item: ChatItem): AgentState {
  return state.items.some((row) => row.id === item.id)
    ? state
    : { ...state, items: [...state.items, item] };
}
export function agentReducer(
  state: AgentState,
  event: AgentModelEvent,
): AgentState {
  switch (event.type) {
    case 'reset':
      return createAgentState(event.input);
    case 'appendUser':
      return { ...append(state, event.item), openGroupId: undefined };
    case 'appendSystem':
      return {
        ...append(state, { kind: 'system', id: event.id, text: event.text }),
        openGroupId: undefined,
      };
    case 'markSend':
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === 'user' && item.id === event.id
            ? {
                ...item,
                delivery: event.delivery,
                interrupt:
                  event.delivery === 'failed' ? undefined : item.interrupt,
              }
            : item,
        ),
      };
    case 'connectionChanged': {
      const next = { ...state, connected: event.connected };
      return state.connected === false && event.connected
        ? append(next, { kind: 'system', id: event.id, text: 'reconnected' })
        : next;
    }
    case 'receive':
      return receiveAgentEvent(state, event.event, event.receivedAtMs);
  }
}
export function receiveAgentEvent(
  state: AgentState,
  event: ServerEvent,
  receivedAtMs: number,
): AgentState {
  switch (event.t) {
    case 'agent.status': {
      let next: AgentState = { ...state, status: event };
      if (event.state !== 'thinking' || event.label !== 'reading your note')
        return next;
      const pending = state.items.filter(
        (item) => item.kind === 'user' && item.interrupt === 'pending',
      );
      const matching = event.inReplyTo
        ? pending.filter((item) => item.id === event.inReplyTo)
        : pending;
      if (matching.length !== 1)
        return diagnostic(
          next,
          'interrupt ACK has no unambiguous pending identity',
        );
      const id = matching[0]?.id;
      // A local user row closes the grouping cursor; mark the last actual group instead.
      const group = [...state.items]
        .reverse()
        .find((item) => item.kind === 'action-group');
      next = {
        ...next,
        openGroupId: undefined,
        responseToNote: true,
        items: state.items.map((item) =>
          item.kind === 'user' && item.id === id
            ? { ...item, interrupt: 'read' }
            : item.kind === 'action-group' && item.id === group?.id
              ? { ...item, stoppedAdjusting: true }
              : item,
        ),
      };
      return next;
    }
    case 'agent.action.start': {
      if (state.recordedActionIds.includes(event.id) || state.actions[event.id])
        return state;
      const groupId = state.openGroupId ?? `group:${event.id}`;
      const existing = state.items.find(
        (item) => item.id === groupId && item.kind === 'action-group',
      );
      const items: readonly ChatItem[] = existing
        ? state.items.map((item) =>
            item.kind === 'action-group' && item.id === groupId
              ? { ...item, actionIds: [...item.actionIds, event.id] }
              : item,
          )
        : [
            ...state.items,
            {
              kind: 'action-group',
              id: groupId,
              actionIds: [event.id],
              responseToNote: state.responseToNote,
              stoppedAdjusting: false,
            },
          ];
      return {
        ...state,
        items,
        openGroupId: groupId,
        responseToNote: false,
        foregroundActionId: event.id,
        actionOrder: [...state.actionOrder, event.id],
        recordedActionIds: [...state.recordedActionIds, event.id],
        actions: {
          ...state.actions,
          [event.id]: {
            id: event.id,
            groupId,
            tool: event.tool,
            title: event.title,
            args: { ...event.args },
            target: event.target,
            status: 'running',
            receivedAtMs,
          },
        },
      };
    }
    case 'agent.action.progress': {
      const action = state.actions[event.id];
      return !action || action.status !== 'running'
        ? state
        : {
            ...state,
            actions: {
              ...state.actions,
              [event.id]: { ...action, pct: event.pct, note: event.note },
            },
          };
    }
    case 'agent.action.end': {
      const action = state.actions[event.id];
      if (!action || action.status !== 'running') return state;
      const next: AgentState = {
        ...state,
        foregroundActionId:
          state.foregroundActionId === event.id
            ? undefined
            : state.foregroundActionId,
        actions: {
          ...state.actions,
          [event.id]: {
            ...action,
            status: event.ok
              ? 'done'
              : event.error === 'stopped by pause'
                ? 'stopped'
                : 'failed',
            durationMs: event.durationMs,
            error: event.error,
            resultSummary: event.resultSummary,
          },
        },
      };
      return !event.ok && event.error !== 'stopped by pause'
        ? append(next, {
            kind: 'error',
            id: `error:${event.id}`,
            actionId: event.id,
            message: event.error ?? 'step failed',
          })
        : next;
    }
    case 'agent.message': {
      const previous = state.items.find((item) => item.id === event.id);
      if (previous) {
        if (
          previous.kind !== 'say' ||
          !previous.stream ||
          previous.stream.done ||
          !event.stream ||
          event.kind !== 'say' ||
          event.stream.sequence <= previous.stream.sequence
        )
          return state;
        if (!event.text.startsWith(previous.text))
          return diagnostic(state, 'stream text is not cumulative');
        return {
          ...state,
          items: state.items.map((item) =>
            item.id === event.id
              ? {
                  kind: 'say',
                  id: event.id,
                  text: event.text,
                  stream: event.stream,
                }
              : item,
          ),
        };
      }
      const item: ChatItem =
        event.kind === 'say'
          ? {
              kind: 'say',
              id: event.id,
              text: event.text,
              stream: event.stream,
            }
          : event.kind === 'ask_review'
            ? { kind: 'review', id: event.id, text: event.text }
            : {
                kind: 'choice',
                id: event.id,
                text: event.text,
                choices: (event.choices ?? []).slice(0, 4),
              };
      return { ...append(state, item), openGroupId: undefined };
    }
    case 'asset.added': {
      const next = {
        ...state,
        assets: { ...state.assets, [event.asset.id]: event.asset },
      };
      if (event.asset.source !== 'web') return next;
      const id = event.actionId
        ? `web:${event.actionId}`
        : `web:asset:${event.asset.id}`;
      const previous = state.items.find((item) => item.id === id);
      if (previous?.kind === 'web-images')
        return {
          ...next,
          items: state.items.map((item) =>
            item.id === id && item.kind === 'web-images'
              ? {
                  ...item,
                  assetIds: [...new Set([...item.assetIds, event.asset.id])],
                }
              : item,
          ),
        };
      return append(next, {
        kind: 'web-images',
        id,
        actionId: event.actionId,
        assetIds: [event.asset.id],
      });
    }
    case 'sam.mask':
      return append(state, {
        kind: 'sam',
        id: `sam:${event.actionId ?? 'uncorrelated'}:${event.clipId}:${event.maskAssetId}`,
        actionId: event.actionId,
        clipId: event.clipId,
        maskAssetId: event.maskAssetId,
        subjectLabel: event.subjectLabel,
        coordinateSpace: event.coordinateSpace,
      });
    case 'error':
      return append(state, {
        kind: 'error',
        id: `error:${event.code}:${event.message}`,
        message: event.message,
      });
    default:
      return state;
  }
}
