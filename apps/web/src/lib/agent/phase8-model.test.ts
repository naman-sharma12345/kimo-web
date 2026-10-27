import { describe, it, expect } from 'vitest';
import type { ServerEvent, Asset } from '@kimo/client';
import { createAgentState, receiveAgentEvent, agentReducer } from './reducer';
import {
  selectActions,
  selectForegroundAction,
  selectGroupActions,
  selectCanFinish,
} from './selectors';
import type { AgentState } from './types';
const start = (id: string, tool = 'trim_clip'): ServerEvent => ({
  t: 'agent.action.start',
  id,
  tool,
  title: 'trimming beach_02',
  args: { clip: 'beach_02' },
  target: { clipId: 'c1', time: 2 },
});
const end = (id: string, ok = true): ServerEvent => ({
  t: 'agent.action.end',
  id,
  ok,
  durationMs: 100,
  ...(!ok ? { error: 'synthetic failure' } : {}),
  resultSummary: 'actual supplied summary',
});
const receive = (state: AgentState, event: ServerEvent) =>
  receiveAgentEvent(state, event, 123);
const initial = () =>
  createAgentState({ sessionId: 's', originalPrompt: 'make a cut' });
function note(state: AgentState, id = 'note') {
  return agentReducer(state, {
    type: 'appendUser',
    item: {
      kind: 'user',
      id,
      text: 'slower',
      receivedAtMs: 100,
      delivery: 'sending',
      attachments: [],
      interrupt: 'pending',
    },
  });
}
describe('Phase 8 pure agent model', () => {
  it('seeds exactly one original prompt and hydrates eligibility, not fabricated history', () => {
    const state = createAgentState({
      sessionId: 's',
      originalPrompt: 'make a cut',
      actionIds: ['old', 'old'],
    });
    expect(state.items).toHaveLength(1);
    expect(state.recordedActionIds).toEqual(['old']);
    expect(state.actions).toEqual({});
    expect(selectCanFinish(state)).toBe(true);
    expect(receive(state, start('old'))).toBe(state);
    expect(
      agentReducer(state, { type: 'reset', input: { sessionId: 'next' } }),
    ).toEqual(createAgentState({ sessionId: 'next' }));
  });
  it('groups consecutive calls, deduplicates starts, preserves immutable inputs and authoritative summaries', () => {
    const state = initial();
    const one = receive(state, start('one'));
    const two = receive(one, start('two'));
    expect(state.actions).toEqual({});
    expect(one.actionOrder).toEqual(['one']);
    expect(receive(two, start('two'))).toBe(two);
    expect(selectGroupActions(two, 'group:one').map((a) => a.id)).toEqual([
      'one',
      'two',
    ]);
    const progress = receive(two, {
      t: 'agent.action.progress',
      id: 'one',
      pct: 0.5,
      note: 'half',
    });
    expect(progress.actions.one?.pct).toBe(0.5);
    const done = receive(progress, end('one'));
    expect(selectForegroundAction(done)?.id).toBe('two');
    expect(done.actions.one).toMatchObject({
      status: 'done',
      resultSummary: 'actual supplied summary',
    });
    expect(receive(done, end('one', false))).toBe(done);
    expect(receive(done, end('missing'))).toBe(done);
    const failed = receive(done, end('two', false));
    expect(selectForegroundAction(failed)).toBeUndefined();
    expect(failed.items.at(-1)).toMatchObject({
      kind: 'error',
      actionId: 'two',
    });
  });
  it('closes groups at conversational messages and never fabricates missing starts', () => {
    let state = receive(initial(), start('one'));
    state = receive(state, {
      t: 'agent.message',
      id: 'say',
      role: 'agent',
      kind: 'say',
      text: 'hello',
    });
    state = receive(state, start('two'));
    expect(state.actions.two?.groupId).toBe('group:two');
    expect(
      receive(state, { t: 'agent.action.progress', id: 'missing', pct: 1 }),
    ).toBe(state);
  });
  it('ACKs only exact thinking label, closes the actual old group and marks response group', () => {
    let state = note(receive(initial(), start('one')));
    state = agentReducer(state, {
      type: 'markSend',
      id: 'note',
      delivery: 'accepted',
    });
    state = receive(state, {
      t: 'agent.status',
      state: 'thinking',
      label: 'other',
    });
    expect(state.items.at(-1)).toMatchObject({
      interrupt: 'pending',
      delivery: 'accepted',
    });
    state = receive(state, end('one'));
    state = receive(state, {
      t: 'agent.status',
      state: 'thinking',
      label: 'reading your note',
    });
    expect(state.items.at(-1)).toMatchObject({ interrupt: 'read' });
    expect(state.items.find((i) => i.kind === 'action-group')).toMatchObject({
      stoppedAdjusting: true,
    });
    state = receive(state, start('response'));
    expect(state.items.at(-1)).toMatchObject({
      responseToNote: true,
      id: 'group:response',
    });
    expect(state.actions.one?.status).toBe('done');
  });
  it('does not guess multiple pending note correlation; supports explicit optional identity', () => {
    const state = note(note(initial(), 'a'), 'b');
    const ambiguous = receive(state, {
      t: 'agent.status',
      state: 'thinking',
      label: 'reading your note',
    });
    expect(ambiguous.diagnostics).toHaveLength(1);
    expect(
      ambiguous.items.filter(
        (i) => i.kind === 'user' && i.interrupt === 'read',
      ),
    ).toHaveLength(0);
    const precise = receive(state, {
      t: 'agent.status',
      state: 'thinking',
      label: 'reading your note',
      inReplyTo: 'b',
    });
    expect(precise.items.at(-1)).toMatchObject({ id: 'b', interrupt: 'read' });
  });
  it('uses cumulative stream identity, increasing sequence and terminal done protection', () => {
    const packet = (
      sequence: number,
      text: string,
      done = false,
    ): ServerEvent => ({
      t: 'agent.message',
      id: 'stream',
      kind: 'say',
      role: 'agent',
      text,
      stream: { sequence, done },
    });
    const first = receive(initial(), packet(0, 'one'));
    expect(receive(first, packet(0, 'one'))).toBe(first);
    const second = receive(first, packet(2, 'one two'));
    expect(receive(second, packet(1, 'one'))).toBe(second);
    expect(receive(second, packet(3, 'replacement')).diagnostics).toHaveLength(
      1,
    );
    const final = receive(second, packet(3, 'one two three', true));
    expect(receive(final, packet(4, 'one two three four'))).toBe(final);
    expect(final.items.filter((i) => i.id === 'stream')).toHaveLength(1);
  });
  it('renders all nine discriminants with explicit web/SAM identities, no temporal guessing', () => {
    let state = receive(initial(), start('one'));
    for (const [kind, id] of [
      ['say', 'say'],
      ['ask_review', 'review'],
      ['ask_choice', 'choice'],
    ] as const)
      state = receive(state, {
        t: 'agent.message',
        id,
        role: 'agent',
        kind,
        text: 'test',
        choices: ['1', '2', '3', '4', '5'],
      });
    state = agentReducer(state, {
      type: 'appendSystem',
      id: 'system',
      text: 'you stopped kimo',
    });
    const asset: Asset = {
      id: 'web1',
      kind: 'image',
      name: 'pattern',
      url: '/pattern',
      source: 'web',
    };
    state = receive(state, { t: 'asset.added', asset });
    state = receive(state, {
      t: 'asset.added',
      asset: { ...asset, id: 'web2' },
      actionId: 'one',
    });
    state = receive(state, {
      t: 'asset.added',
      asset: { ...asset, id: 'web3' },
      actionId: 'one',
    });
    state = receive(state, {
      t: 'sam.mask',
      clipId: 'c1',
      maskAssetId: 'mask',
      previewPolygon: [],
    });
    state = receive(state, {
      t: 'error',
      code: 'FAIL',
      message: 'actual error',
    });
    expect(new Set(state.items.map((i) => i.kind)).size).toBe(9);
    expect(state.items.find((i) => i.id === 'web:asset:web1')).toMatchObject({
      assetIds: ['web1'],
      actionId: undefined,
    });
    expect(state.items.find((i) => i.id === 'web:one')).toMatchObject({
      assetIds: ['web2', 'web3'],
    });
    expect(state.items.find((i) => i.kind === 'sam')).toMatchObject({
      actionId: undefined,
      subjectLabel: undefined,
    });
    expect(state.items.find((i) => i.kind === 'choice')).toMatchObject({
      choices: ['1', '2', '3', '4'],
    });
    expect(
      receive(state, { t: 'error', code: 'FAIL', message: 'actual error' }),
    ).toBe(state);
  });
  it('filters exact AI/edit aliases, target searches, stopped results and reconnect transitions', () => {
    let state = receive(
      receive(initial(), start('one')),
      start('two', 'sam_mask'),
    );
    expect(
      selectActions(state, { filter: 'ai models' }).map((a) => a.id),
    ).toEqual(['two']);
    expect(
      selectActions(state, { filter: 'edits', search: 'c1' }).map((a) => a.id),
    ).toEqual(['one']);
    state = receive(state, {
      t: 'agent.action.end',
      id: 'two',
      ok: false,
      error: 'stopped by pause',
      durationMs: 0,
    });
    expect(state.actions.two?.status).toBe('stopped');
    expect(selectActions(state, { filter: 'failed' })).toEqual([]);
    state = agentReducer(state, {
      type: 'connectionChanged',
      connected: true,
      id: 'initial',
    });
    expect(state.items.some((i) => i.id === 'initial')).toBe(false);
    state = agentReducer(state, {
      type: 'connectionChanged',
      connected: false,
      id: 'offline',
    });
    state = agentReducer(state, {
      type: 'connectionChanged',
      connected: true,
      id: 'reconnect',
    });
    expect(state.items.at(-1)).toMatchObject({ text: 'reconnected' });
  });
});
