import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTelemetry,
  EDIT_OPS,
  type AnalyticsEvents,
  type SafeTransport,
} from './telemetry';
import { createSender } from './telemetry/transport';
const config = { endpoint: 'https://collector.example.test/aggregate' };
const prompt = {
  length: 5,
  file_counts: { video: 1, image: 2, audio: 0, doc: 0 },
};
const sentinel =
  'private prompt Alice secret-file.mov session-123 https://media.example.test/x?token=secret';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function untypedTrack(
  track: ReturnType<typeof createTelemetry>['track'],
  event: unknown,
  payload: unknown,
) {
  (track as (event: unknown, payload: unknown) => void)(event, payload);
}
describe('identity-free analytics', () => {
  it('supports exactly the specified event shapes and every wire op enum', async () => {
    const send = vi.fn();
    const telemetry = createTelemetry(config, send);
    telemetry.track('prompt_sent', prompt);
    for (const event of [
      'warmup_duration',
      'first_op_latency',
      'render_done',
    ] as const)
      telemetry.track(event, { duration_ms: 20 });
    for (const event of [
      'interrupt_sent',
      'review_shown',
      'render_started',
      'download_clicked',
      'share_clicked',
    ] as const)
      telemetry.track(event, {});
    for (const op_type of EDIT_OPS) {
      telemetry.track('user_edit', { op_type });
      await Promise.resolve();
    }
    expect(send).toHaveBeenCalledTimes(9 + EDIT_OPS.length);
    expect(send.mock.calls[0]?.[0]).toEqual({
      event: 'prompt_sent',
      properties: prompt,
    });
    const wire = JSON.stringify(send.mock.calls.map((call) => call[0]));
    for (const denied of [
      'distinct_id',
      '$current_url',
      '$referrer',
      'user_id',
      'session_id',
      sentinel,
    ])
      expect(wire).not.toContain(denied);
    expect(Object.keys(telemetry)).toEqual(['track']);
  });
  it.each([
    undefined,
    {},
    { endpoint: '' },
    { endpoint: 'http://collector.example.test/x' },
    { endpoint: 'https://a:b@collector.example.test/x' },
    { endpoint: 'https://collector.example.test/x?token=secret' },
    { endpoint: 'https://collector.example.test/#secret' },
    { ...config, enabled: false },
  ])('is no-op for missing/unsafe/disabled config %j', (value) => {
    const send = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.useFakeTimers();
    createTelemetry(value, send).track('prompt_sent', prompt);
    expect(send).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects extra keys at any depth, raw state, unknown events, symbols, prototypes and accessors', () => {
    const send = vi.fn();
    const { track } = createTelemetry(config, send);
    const getter = vi.fn(() => sentinel);
    const getterPayload = Object.defineProperty({}, 'duration_ms', {
      get: getter,
    });
    const poisoned = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(sentinel);
        },
      },
    );
    const cases: [unknown, unknown][] = [
      ['prompt_sent', { ...prompt, prompt: sentinel }],
      [
        'prompt_sent',
        { ...prompt, file_counts: { ...prompt.file_counts, name: sentinel } },
      ],
      ['user_edit', { op_type: 'text.update', text: sentinel }],
      ['user_edit', { op_type: sentinel }],
      ['pageview', {}],
      ['identify', { id: sentinel }],
      ['interrupt_sent', { session_id: sentinel }],
      ['render_done', { duration_ms: 2, stack: sentinel }],
      ['render_done', getterPayload],
      ['render_done', poisoned],
      ['render_done', Object.create({ duration_ms: 2 })],
      ['review_shown', { [Symbol(sentinel)]: sentinel }],
      ['prompt_sent', { ...prompt, file_counts: [] }],
    ];
    for (const [event, value] of cases)
      expect(() => untypedTrack(track, event, value)).not.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([-1, Infinity, NaN, 1.2, 86400001, '2', null])(
    'rejects invalid durations %s',
    (duration_ms) => {
      const send = vi.fn();
      untypedTrack(createTelemetry(config, send).track, 'render_done', {
        duration_ms,
      });
      expect(send).not.toHaveBeenCalled();
    },
  );
  it('validates numeric endpoints and reconstructs input without retaining mutable state', async () => {
    const send = vi.fn();
    const { track } = createTelemetry(config, send);
    track('prompt_sent', {
      length: 1000000,
      file_counts: { video: 10000, image: 0, audio: 0, doc: 0 },
    });
    track('render_done', { duration_ms: 86400000 });
    const input = { ...prompt, file_counts: { ...prompt.file_counts } };
    track('prompt_sent', input);
    input.file_counts.video = 999;
    expect(send.mock.calls[2]?.[0].properties.file_counts.video).toBe(1);
    track('prompt_sent', { ...prompt, length: 1000001 });
    track('prompt_sent', {
      ...prompt,
      file_counts: { ...prompt.file_counts, video: 10001 },
    });
    track('prompt_sent', {
      ...prompt,
      file_counts: { ...prompt.file_counts, audio: -1 },
    });
    expect(send).toHaveBeenCalledTimes(3);
    await Promise.resolve();
  });
  it('never reads storage/location/DOM or adds listeners', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const send = vi.fn();
    createTelemetry(config, send).track('review_shown', {});
    expect(add).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    expect(send.mock.calls[0]?.[0]).toEqual({
      event: 'review_shown',
      properties: {},
    });
  });
  it('bounds in-flight and rate with no retries or retained event queue', async () => {
    vi.useFakeTimers();
    const send = vi.fn<SafeTransport>(() => new Promise<void>(() => undefined));
    const telemetry = createTelemetry(config, send);
    for (let n = 0; n < 21; n++) telemetry.track('review_shown', {});
    expect(send).toHaveBeenCalledTimes(20);
    await vi.advanceTimersByTimeAsync(3000);
    expect(send.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(send).toHaveBeenCalledTimes(20);
    for (let batch = 0; batch < 4; batch++) {
      for (let n = 0; n < 20; n++) telemetry.track('review_shown', {});
      await vi.advanceTimersByTimeAsync(3000);
    }
    telemetry.track('review_shown', {});
    expect(send).toHaveBeenCalledTimes(100);
    await vi.advanceTimersByTimeAsync(60000);
    telemetry.track('review_shown', {});
    expect(send).toHaveBeenCalledTimes(101);
  });
  it('default fetch omits identity/referrer/redirect and never retries failures', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new Error(sentinel));
    vi.stubGlobal('fetch', fetch);
    createTelemetry(config).track('review_shown', {});
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      config.endpoint,
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
      }),
    );
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
      event: 'review_shown',
      properties: {},
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('silences sync/async transport failures and rejects oversized sender payload', async () => {
    const sink: SafeTransport = () => {
      throw new Error(sentinel);
    };
    expect(() =>
      createTelemetry(config, sink).track('review_shown', {}),
    ).not.toThrow();
    createTelemetry(config, () => Promise.reject(new Error(sentinel))).track(
      'review_shown',
      {},
    );
    const send = vi.fn();
    createSender(config, send, { bytes: 10, perMinute: 1, inFlight: 1 })({
      excessive: sentinel,
    });
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  });
});
// Root tsconfig includes this test: these compile-only invalid calls are never executed.
function typeContract(telemetry: ReturnType<typeof createTelemetry>) {
  // @ts-expect-error Unknown event names cannot compile.
  telemetry.track('pageview', {});
  // @ts-expect-error Op content is not an analytics category.
  telemetry.track('user_edit', { op_type: 'custom.private' });
  // @ts-expect-error Prompt text is forbidden.
  telemetry.track('prompt_sent', { prompt: 'secret' });
  const valid: AnalyticsEvents['render_done'] = { duration_ms: 1 };
  return valid;
}
void typeContract;
