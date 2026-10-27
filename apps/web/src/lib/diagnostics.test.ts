import { describe, expect, it, vi } from 'vitest';
import {
  assetCounts,
  attachmentCounts,
  createDiagnosticsTiming,
} from './diagnostics';
import { createTelemetry } from './telemetry';

const payload = {
  length: 12,
  file_counts: { video: 1, image: 0, audio: 0, doc: 0 },
};
const op = { version: 1, ops: [{}], author: 'agent' as const };
function setup() {
  let time = 10;
  const track = vi.fn();
  const timing = createDiagnosticsTiming({ track }, () => time);
  return {
    timing,
    track,
    at: (value: number) => {
      time = value;
    },
  };
}
describe('same-tab diagnostics boundaries', () => {
  it('does not invent a prompt timestamp for restored sessions', () => {
    const { timing, track } = setup();
    timing.applied('restored-secret', 0, 1, op);
    expect(track).not.toHaveBeenCalled();
  });
  it('binds only a real prompt clock, rounds elapsed, and consumes it once', () => {
    const { timing, track, at } = setup();
    const prompt = timing.beginPrompt(payload);
    at(25);
    prompt.bind('private-session');
    at(40.6);
    timing.applied('other-session', 0, 1, op);
    timing.applied('private-session', 0, 1, op);
    timing.applied('private-session', 1, 2, { ...op, version: 2 });
    expect(track.mock.calls).toEqual([
      ['prompt_sent', payload],
      ['first_op_latency', { duration_ms: 31 }],
    ]);
    expect(JSON.stringify(track.mock.calls)).not.toContain('private-session');
  });
  it.each([
    { before: 1, after: 1, event: op }, // replay
    { before: 0, after: 0, event: op }, // not applied
    { before: 0, after: 1, event: { ...op, ops: [] } },
    { before: 0, after: 1, event: { ...op, author: 'user' as const } },
    {
      before: 0,
      after: 1,
      event: { ...op, clientMutationId: 'private-mutation' },
    },
  ])(
    'ignores non-authoritative or user-edit boundary %#',
    ({ before, after, event }) => {
      const { timing, track } = setup();
      timing.beginPrompt(payload).bind('s');
      timing.applied('s', before, after, event);
      expect(track).toHaveBeenCalledTimes(1);
    },
  );
  it('invalidates a gap/refetch rather than timing the next packet', () => {
    const { timing, track } = setup();
    timing.beginPrompt(payload).bind('s');
    timing.applied('s', 0, 2, { ...op, version: 2 });
    timing.applied('s', 2, 3, { ...op, version: 3 });
    expect(track).toHaveBeenCalledTimes(1);
  });
  it('can invalidate snapshot replacement without publishing snapshot fields', () => {
    const { timing, track } = setup();
    timing.beginPrompt(payload).bind('s');
    timing.discard('s');
    timing.applied('s', 0, 1, op);
    expect(track).toHaveBeenCalledTimes(1);
  });
  it('failed older sends cannot cancel a newer prompt clock', () => {
    const { timing, track, at } = setup();
    const older = timing.beginPrompt(payload);
    older.bind('s');
    at(30);
    timing.beginPrompt(payload).bind('s');
    older.cancel();
    at(45);
    timing.applied('s', 0, 1, op);
    expect(track).toHaveBeenLastCalledWith('first_op_latency', {
      duration_ms: 15,
    });
  });
  it('does not time failed sends', () => {
    const { timing, track } = setup();
    const prompt = timing.beginPrompt(payload);
    prompt.bind('s');
    prompt.cancel();
    timing.applied('s', 0, 1, op);
    expect(track).toHaveBeenCalledTimes(1);
  });
  it('bounds local correlations without emitting evicted session identifiers', () => {
    const { timing, track } = setup();
    for (let i = 0; i < 33; i++)
      timing.beginPrompt(payload).bind(`private-${i}`);
    track.mockClear();
    timing.applied('private-0', 0, 1, op);
    expect(track).not.toHaveBeenCalled();
    timing.applied('private-32', 0, 1, op);
    expect(track.mock.calls).toEqual([
      ['first_op_latency', { duration_ms: 0 }],
    ]);
  });
  it.each(['warmup_duration', 'render_done'] as const)(
    '%s measures only observed active-to-done once',
    (event) => {
      const { timing, track, at } = setup();
      const observe = timing.interval(event);
      observe('active');
      at(25);
      observe('active');
      at(60.4);
      observe('done');
      observe('done');
      expect(track.mock.calls).toEqual([[event, { duration_ms: 50 }]]);
    },
  );
  it.each(['warmup_duration', 'render_done'] as const)(
    '%s suppresses restored done and failed/cancelled intervals',
    (event) => {
      const { timing, track } = setup();
      timing.interval(event)('done');
      const observe = timing.interval(event);
      observe('active');
      observe('reset');
      observe('done');
      expect(track).not.toHaveBeenCalled();
    },
  );
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 86400011])(
    'rejects invalid elapsed clock %s',
    (end) => {
      const { timing, track, at } = setup();
      timing.beginPrompt(payload).bind('s');
      const observe = timing.interval('render_done');
      observe('active');
      at(end);
      timing.applied('s', 0, 1, op);
      observe('done');
      expect(track).toHaveBeenCalledTimes(1);
    },
  );
  it('does not persist a timer in a fresh module-owner instance', () => {
    const { timing, track } = setup();
    timing.beginPrompt(payload).bind('s');
    createDiagnosticsTiming({ track }).applied('s', 0, 1, op);
    expect(track).toHaveBeenCalledTimes(1);
  });
  it('counts only MIME/category counters, never names or other asset properties', () => {
    expect(
      attachmentCounts([
        new File(['secret'], 'private.mov', { type: 'video/mp4' }),
        new File([], 'private.png', { type: 'image/png' }),
        new File([], 'private.wav', { type: 'audio/wav' }),
        new File([], 'private.txt'),
      ]),
    ).toEqual({ video: 1, image: 1, audio: 1, doc: 1 });
    expect(
      assetCounts([{ kind: 'audio' }, { kind: 'doc' }, { kind: 'audio' }]),
    ).toEqual({ video: 0, image: 0, audio: 2, doc: 1 });
  });
  it('keeps missing endpoint fully inert even with real observations', () => {
    const send = vi.fn();
    const timing = createDiagnosticsTiming(createTelemetry({}, send), () => 10);
    timing.beginPrompt(payload).bind('private');
    timing.applied('private', 0, 1, op);
    const observe = timing.interval('render_done');
    observe('active');
    observe('done');
    expect(send).not.toHaveBeenCalled();
  });
});
