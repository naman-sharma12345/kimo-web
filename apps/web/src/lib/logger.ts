import { exactRecord, integer } from './telemetry/transport';
export const DIAGNOSTIC_CODES = [
  'upload_failed',
  'connection_closed',
  'restore_failed',
  'render_failed',
  'storage_unavailable',
  'unexpected_error',
] as const;
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];
const CATEGORIES = [
  'network',
  'render',
  'restore',
  'storage',
  'unknown',
] as const;
export interface DiagnosticContext {
  category?: (typeof CATEGORIES)[number];
  count?: number;
}
type Level = 'debug' | 'info' | 'warn' | 'error';
export type DiagnosticSink = (
  level: Level,
  code: DiagnosticCode,
  context: DiagnosticContext,
) => void;
export type Logger = Record<
  Level,
  (code: DiagnosticCode, context?: DiagnosticContext) => void
>;
export function createLogger(
  options: { production: boolean },
  sink?: DiagnosticSink,
): Logger {
  const emit = (
    level: Level,
    code: DiagnosticCode,
    context: DiagnosticContext = {},
  ) => {
    if (options.production) return;
    try {
      if (!(DIAGNOSTIC_CODES as readonly string[]).includes(code)) return;
      const record = exactRecord(context, [], ['category', 'count']);
      if (
        !record ||
        (record.category !== undefined &&
          (typeof record.category !== 'string' ||
            !(CATEGORIES as readonly string[]).includes(record.category))) ||
        (record.count !== undefined && !integer(record.count, 1000000))
      )
        return;
      const clean: DiagnosticContext = {};
      if (record.category !== undefined)
        clean.category = record.category as DiagnosticContext['category'];
      if (record.count !== undefined) clean.count = record.count as number;
      if (sink) sink(level, code, clean);
      else console[level](code, clean);
    } catch {
      /* Logging cannot break the application. */
    }
  };
  return {
    debug: (code, context) => emit('debug', code, context),
    info: (code, context) => emit('info', code, context),
    warn: (code, context) => emit('warn', code, context),
    error: (code, context) => emit('error', code, context),
  };
}
/** Deliberately silent in production, test and unknown environments. */
export const logger = createLogger({
  production: process.env.NODE_ENV !== 'development',
});
