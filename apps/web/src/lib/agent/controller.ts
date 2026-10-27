import type { Asset, ClientEvent, ServerEvent } from '@kimo/client';
import { agentReducer, createAgentState } from './reducer';
import type { AgentModelEvent, AgentReset, UserItem } from './types';

export interface AgentTransport {
  /** True only when the one Shell socket is open. */
  send(packet: ClientEvent): boolean;
  message(text: string): Promise<void>;
  assets(): readonly Asset[];
  acting(): boolean;
  userSent?(): void;
  attention?(event: { id: string; kind: 'ask_review' | 'ask_choice' }): void;
  intent?(state: 'paused' | 'thinking'): void;
  now?(): number;
  makeId?(): string;
}
/** UI model and dispatch intent only. Does not create a socket or editing authority. */
export function createAgentController(
  reset: AgentReset,
  transport: AgentTransport,
) {
  let state = createAgentState(reset);
  let disposed = false;
  let sequence = 0;
  const listeners = new Set<() => void>();
  const id = () =>
    transport.makeId?.() ?? `user:${reset.sessionId}:${++sequence}`;
  const publish = (event: AgentModelEvent) => {
    if (disposed) return;
    const next = agentReducer(state, event);
    if (next === state) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  const system = (text: string) =>
    publish({ type: 'appendSystem', id: id(), text });
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    system,
    connection(connected: boolean) {
      publish({ type: 'connectionChanged', connected, id: id() });
    },
    receive(event: ServerEvent) {
      publish({
        type: 'receive',
        event,
        receivedAtMs: transport.now?.() ?? Date.now(),
      });
      if (
        event.t === 'agent.message' &&
        (event.kind === 'ask_review' || event.kind === 'ask_choice')
      )
        transport.attention?.({ id: event.id, kind: event.kind });
    },
    async send(input: { text: string; attachmentIds?: readonly string[] }) {
      if (disposed) throw new Error('conversation is no longer connected');
      const text = input.text.trim();
      if (!text && !input.attachmentIds?.length)
        throw new Error('write a note before sending');
      const interrupt = transport.acting();
      if (
        interrupt &&
        state.items.some(
          (item) => item.kind === 'user' && item.interrupt === 'pending',
        )
      )
        throw new Error('wait for kimo to read your previous note');
      const ids = input.attachmentIds ?? [];
      const assets = transport.assets();
      if (ids.some((assetId) => !assets.some((asset) => asset.id === assetId)))
        throw new Error('wait for attachment confirmation before sending');
      const messageId = id();
      const row: UserItem = {
        kind: 'user',
        id: messageId,
        text,
        attachments: assets.filter((asset) => ids.includes(asset.id)),
        receivedAtMs: transport.now?.() ?? Date.now(),
        delivery: 'sending',
        ...(interrupt ? { interrupt: 'pending' } : {}),
      };
      publish({ type: 'appendUser', item: row });
      if (!text) {
        publish({ type: 'markSend', id: messageId, delivery: 'accepted' });
        transport.userSent?.();
        return;
      }
      if (interrupt) {
        // Legacy wire: one pending interrupt, no guessed producer identity capability.
        let sent = false;
        try {
          sent = transport.send({ t: 'interrupt', text });
        } catch {
          /* No read ACK inferred. */
        }
        publish({
          type: 'markSend',
          id: messageId,
          delivery: sent ? 'accepted' : 'failed',
        });
        if (!sent)
          throw new Error('not connected; your note was not dispatched');
        transport.userSent?.();
        return;
      }
      try {
        // Attachment IDs are already associated by the confirmed upload adapter.
        // Do not attach twice or duplicate an interrupt through HTTP.
        await transport.message(text);
        publish({ type: 'markSend', id: messageId, delivery: 'accepted' });
        if (!disposed) transport.userSent?.();
      } catch (error) {
        publish({ type: 'markSend', id: messageId, delivery: 'unknown' });
        throw error;
      }
    },
    pause(hard = false) {
      if (disposed || !transport.send({ t: 'pause' }))
        throw new Error('not connected; pause was not dispatched');
      transport.intent?.('paused');
      system(hard ? 'you stopped kimo' : 'you paused kimo');
    },
    resume() {
      if (disposed || !transport.send({ t: 'resume' }))
        throw new Error('not connected; resume was not dispatched');
      transport.intent?.('thinking');
      system('you let kimo continue');
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
export type AgentController = ReturnType<typeof createAgentController>;
