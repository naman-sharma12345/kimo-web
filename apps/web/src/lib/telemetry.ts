import {
  createSender,
  exactRecord,
  integer,
  type JsonValue,
  type SafeTransport,
  type TelemetryConfig,
} from './telemetry/transport';
export type { TelemetryConfig, SafeTransport } from './telemetry/transport';
export const EDIT_OPS = [
  'project.update',
  'clip.add',
  'clip.update',
  'clip.remove',
  'clip.move',
  'clip.trim',
  'clip.split',
  'track.add',
  'track.remove',
  'track.update',
  'text.update',
  'effect.set',
  'keyframe.set',
  'marker.add',
] as const;
export type AllowedEditOp = (typeof EDIT_OPS)[number];
export interface AnalyticsEvents {
  prompt_sent: {
    length: number;
    file_counts: { video: number; image: number; audio: number; doc: number };
  };
  warmup_duration: { duration_ms: number };
  first_op_latency: { duration_ms: number };
  interrupt_sent: Record<string, never>;
  user_edit: { op_type: AllowedEditOp };
  review_shown: Record<string, never>;
  render_started: Record<string, never>;
  render_done: { duration_ms: number };
  download_clicked: Record<string, never>;
  share_clicked: Record<string, never>;
}
export interface Telemetry {
  track<E extends keyof AnalyticsEvents>(
    event: E,
    payload: AnalyticsEvents[E],
  ): void;
}
const EMPTY_EVENTS: readonly string[] = [
  'interrupt_sent',
  'review_shown',
  'render_started',
  'download_clicked',
  'share_clicked',
];
function sanitize(event: unknown, payload: unknown): JsonValue | undefined {
  if (typeof event !== 'string') return;
  if (EMPTY_EVENTS.includes(event))
    return exactRecord(payload, []) ? { event, properties: {} } : undefined;
  if (event === 'prompt_sent') {
    const record = exactRecord(payload, ['length', 'file_counts']);
    if (!record || !integer(record.length, 1000000)) return;
    const counts = exactRecord(record.file_counts, [
      'video',
      'image',
      'audio',
      'doc',
    ]);
    if (
      !counts ||
      !integer(counts.video, 10000) ||
      !integer(counts.image, 10000) ||
      !integer(counts.audio, 10000) ||
      !integer(counts.doc, 10000)
    )
      return;
    return {
      event,
      properties: {
        length: record.length,
        file_counts: {
          video: counts.video,
          image: counts.image,
          audio: counts.audio,
          doc: counts.doc,
        },
      },
    };
  }
  if (['warmup_duration', 'first_op_latency', 'render_done'].includes(event)) {
    const record = exactRecord(payload, ['duration_ms']);
    if (!record || !integer(record.duration_ms, 86400000)) return;
    return { event, properties: { duration_ms: record.duration_ms } };
  }
  if (event === 'user_edit') {
    const record = exactRecord(payload, ['op_type']);
    if (
      !record ||
      typeof record.op_type !== 'string' ||
      !(EDIT_OPS as readonly string[]).includes(record.op_type)
    )
      return;
    return { event, properties: { op_type: record.op_type } };
  }
}
/** Identity-free aggregates only. Config must name an approved collector, not a guessed cloud host. */
export function createTelemetry(
  config?: TelemetryConfig,
  transport?: SafeTransport,
): Telemetry {
  const send = createSender(config, transport, {
    bytes: 2048,
    perMinute: 100,
    inFlight: 20,
  });
  return {
    track(event, payload) {
      try {
        const clean = sanitize(event, payload);
        if (clean) send(clean);
      } catch {
        /* Untrusted input is silently dropped. */
      }
    },
  };
}
