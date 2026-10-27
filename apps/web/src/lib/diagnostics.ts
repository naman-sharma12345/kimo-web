import {
  createTelemetry,
  type AnalyticsEvents,
  type Telemetry,
} from './telemetry';
import { createErrorReporter } from './error-reporting';
/** No endpoint default, identity, prompt text or persistent analytics state. */
export const analytics = createTelemetry({
  endpoint: process.env.NEXT_PUBLIC_KIMO_TELEMETRY_URL,
});
export const errorReporter = createErrorReporter({
  endpoint: process.env.NEXT_PUBLIC_KIMO_ERROR_REPORT_URL,
});
export function assetCounts(
  assets: readonly { kind: 'video' | 'image' | 'audio' | 'doc' }[],
) {
  const counts = { video: 0, image: 0, audio: 0, doc: 0 };
  for (const asset of assets) counts[asset.kind]++;
  return counts;
}
export function attachmentCounts(files: readonly File[]) {
  const counts = { video: 0, image: 0, audio: 0, doc: 0 };
  for (const file of files) {
    if (file.type.startsWith('video/')) counts.video++;
    else if (file.type.startsWith('image/')) counts.image++;
    else if (file.type.startsWith('audio/')) counts.audio++;
    else counts.doc++;
  }
  return counts;
}

/** Observations are memory-only and scoped to this module instance (one tab).
 * Session keys only correlate local clocks; they never enter an event payload.
 */
export function createDiagnosticsTiming(
  telemetry: Telemetry,
  now: () => number = () => performance.now(),
) {
  const prompts = new Map<string, { start: number }>();
  function elapsed(start: number): number | undefined {
    const value = now() - start;
    if (!Number.isFinite(value) || value < 0 || value > 86400000) return;
    return Math.round(value);
  }
  return {
    beginPrompt(payload: AnalyticsEvents['prompt_sent']) {
      const observation = { start: now() };
      let key: string | undefined;
      telemetry.track('prompt_sent', payload);
      return {
        bind(session: string) {
          key = session;
          prompts.delete(session);
          // Bound retained local correlations, without persistence or identifiers on wire.
          if (prompts.size >= 32) {
            const oldest = prompts.keys().next().value;
            if (oldest !== undefined) prompts.delete(oldest);
          }
          prompts.set(session, observation);
        },
        cancel() {
          if (key !== undefined && prompts.get(key) === observation)
            prompts.delete(key);
        },
      };
    },
    discard(session: string) {
      prompts.delete(session);
    },
    applied(
      session: string,
      before: number,
      after: number,
      event: {
        version: number;
        ops: readonly unknown[];
        author?: 'user' | 'agent';
        clientMutationId?: string;
      },
    ) {
      // A gap/refetch cannot prove when the first op was applied. Never carry
      // that clock forward to a later contiguous packet.
      if (event.version > before + 1 || after > event.version) {
        prompts.delete(session);
        return;
      }
      if (
        !event.ops.length ||
        event.author === 'user' ||
        event.clientMutationId ||
        event.version !== before + 1 ||
        after !== event.version
      )
        return;
      const observation = prompts.get(session);
      if (!observation) return;
      prompts.delete(session);
      const duration_ms = elapsed(observation.start);
      if (duration_ms !== undefined)
        telemetry.track('first_op_latency', { duration_ms });
    },
    interval(event: 'warmup_duration' | 'render_done') {
      let start: number | undefined;
      let finished = false;
      return (state: 'active' | 'done' | 'reset') => {
        if (finished) return;
        if (state === 'reset') {
          start = undefined;
          return;
        }
        if (state === 'active') {
          start ??= now();
          return;
        }
        finished = true;
        if (start === undefined) return;
        const duration_ms = elapsed(start);
        if (duration_ms !== undefined) telemetry.track(event, { duration_ms });
      };
    },
  };
}
export const diagnosticsTiming = createDiagnosticsTiming(analytics);
