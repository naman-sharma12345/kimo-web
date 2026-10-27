/** Private transport for already reconstructed, bounded payloads. No SDK state. */
export interface TelemetryConfig {
  endpoint?: string;
  enabled?: boolean;
}
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];
export type SafeTransport = (
  payload: JsonValue,
  options: { signal: AbortSignal },
) => void | Promise<void>;
export function exactRecord(
  value: unknown,
  keys: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some(
      (key) => typeof key !== 'string' || ![...keys, ...optional].includes(key),
    )
  )
    return;
  if (keys.some((key) => !Object.hasOwn(value, key))) return;
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return;
  }
  return value as Record<string, unknown>;
}
export function integer(value: unknown, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= max
  );
}
function endpointFrom(config: TelemetryConfig | undefined): string | undefined {
  try {
    const record = exactRecord(config, [], ['endpoint', 'enabled']);
    if (
      !record ||
      (record.enabled !== undefined && record.enabled !== true) ||
      typeof record.endpoint !== 'string' ||
      record.endpoint.length > 2048 ||
      /[?#]/.test(record.endpoint)
    )
      return;
    const url = new URL(record.endpoint);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return;
    return url.href;
  } catch {
    return;
  }
}
export function createSender(
  config: TelemetryConfig | undefined,
  transport: SafeTransport | undefined,
  limits: { bytes: number; perMinute: number; inFlight: number },
): (payload: JsonValue) => void {
  const endpoint = endpointFrom(config);
  if (!endpoint) return () => undefined;
  let start = 0;
  let count = 0;
  let inFlight = 0;
  return (payload) => {
    try {
      const body = JSON.stringify(payload);
      if (new TextEncoder().encode(body).length > limits.bytes) return;
      const now = Date.now();
      if (now - start >= 60000 || now < start) {
        start = now;
        count = 0;
      }
      if (count >= limits.perMinute || inFlight >= limits.inFlight) return;
      count++;
      inFlight++;
      const controller = new AbortController();
      let released = false;
      const finish = () => {
        if (released) return;
        released = true;
        inFlight--;
        clearTimeout(timer);
      };
      const timer = setTimeout(() => {
        controller.abort();
        finish();
      }, 3000);
      try {
        const delivery = transport
          ? transport(payload, { signal: controller.signal })
          : fetch(endpoint, {
              method: 'POST',
              body,
              headers: { 'Content-Type': 'application/json' },
              credentials: 'omit',
              referrerPolicy: 'no-referrer',
              redirect: 'error',
              signal: controller.signal,
            });
        void Promise.resolve(delivery).then(finish, finish);
      } catch {
        finish();
      }
    } catch {
      /* Diagnostics must never recurse or expose rejected content. */
    }
  };
}
