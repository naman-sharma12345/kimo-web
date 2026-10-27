export class KimoConfigurationError extends Error {
  readonly code = 'KIMO_CONFIGURATION';
  constructor(variable: string) {
    super(`invalid or missing ${variable} configuration`);
    this.name = 'KimoConfigurationError';
  }
}
function absolute(value: string, variable: string, protocols: string[]): URL {
  try {
    const url = new URL(value);
    if (
      value !== value.trim() ||
      /[\s?#]/.test(value) ||
      !protocols.includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      !/^\w+:\/\//.test(value) ||
      value.includes('\\') ||
      value.includes('?') ||
      value.includes('#')
    )
      throw new Error();
    return url;
  } catch {
    throw new KimoConfigurationError(variable);
  }
}
export function parseApiBase(value: string): string {
  absolute(value, 'NEXT_PUBLIC_KIMO_API', ['http:', 'https:']);
  return value.replace(/\/+$/, '');
}
export function parseWsOrigin(value: string): string {
  const url = absolute(value, 'NEXT_PUBLIC_KIMO_WS', ['ws:', 'wss:']);
  if (url.pathname !== '/')
    throw new KimoConfigurationError('NEXT_PUBLIC_KIMO_WS');
  return url.origin;
}
export function resolveSessionWsUrl(value: string, origin?: string): string {
  try {
    const url = new URL(value);
    if (
      !['ws:', 'wss:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      value.includes('\\') ||
      value !== value.trim()
    )
      throw new Error();
    const match = /^(wss?:)\/\/[^/?#]+([/?][^#]*)?$/.exec(value);
    if (!match) throw new Error();
    return origin ? parseWsOrigin(origin) + (match[2] ?? '') : value;
  } catch {
    throw new KimoConfigurationError('session wsUrl');
  }
}
