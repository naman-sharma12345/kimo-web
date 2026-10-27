import {
  createSender,
  exactRecord,
  type SafeTransport,
  type TelemetryConfig,
} from './telemetry/transport';
export const ERROR_BOUNDARIES = [
  'landing',
  'warmup',
  'studio',
  'render',
  'delivery',
  'privacy',
  'global',
] as const;
export const ERROR_CATEGORIES = [
  'unknown',
  'network',
  'render',
  'restore',
] as const;
export interface ErrorContext {
  boundary: (typeof ERROR_BOUNDARIES)[number];
  category: (typeof ERROR_CATEGORIES)[number];
}
const MESSAGES = {
  unknown: 'Application error',
  network: 'Network operation failed',
  render: 'Render operation failed',
  restore: 'Session restore failed',
} as const;
export interface ErrorReporter {
  report(error: unknown, context: ErrorContext): void;
}
/** Sentry-compatible sanitized event builder. Does not expose message/stack/cause/digest. */
export function createErrorReporter(
  config?: TelemetryConfig,
  transport?: SafeTransport,
): ErrorReporter {
  const send = createSender(config, transport, {
    bytes: 4096,
    perMinute: 10,
    inFlight: 1,
  });
  const seen = new WeakSet<object>();
  return {
    report(error, context) {
      try {
        const safe = exactRecord(context, ['boundary', 'category']);
        if (
          !safe ||
          typeof safe.boundary !== 'string' ||
          !(ERROR_BOUNDARIES as readonly string[]).includes(safe.boundary) ||
          typeof safe.category !== 'string' ||
          !(ERROR_CATEGORIES as readonly string[]).includes(safe.category)
        )
          return;
        const category = safe.category as ErrorContext['category'];
        let type = 'UnknownError';
        if (error instanceof Error) {
          if (seen.has(error)) return;
          seen.add(error);
          // Never read the error's own name, message, stack, cause or any custom property.
          type =
            error instanceof TypeError
              ? 'TypeError'
              : error instanceof RangeError
                ? 'RangeError'
                : 'Error';
        }
        const message = MESSAGES[category];
        send({
          level: 'error',
          message,
          exception: { values: [{ type, value: message }] },
          tags: { boundary: safe.boundary, category },
        });
      } catch {
        /* No recursive reporting, logs, raw error data or application failures. */
      }
    },
  };
}
