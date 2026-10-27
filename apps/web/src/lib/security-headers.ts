export interface SecurityOrigins {
  production: boolean;
  api?: string;
  ws?: string;
  media?: string;
  telemetry?: string;
}
function origin(
  value: string,
  kind: 'http' | 'ws',
  production: boolean,
): string {
  if (
    [...value].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error('invalid security origin configuration');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('invalid security origin configuration');
  }
  const protocols = kind === 'ws' ? ['ws:', 'wss:'] : ['http:', 'https:'];
  if (
    !protocols.includes(url.protocol) ||
    (kind === 'ws' && url.pathname !== '/') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (production && !['https:', 'wss:'].includes(url.protocol))
  )
    throw new Error('invalid security origin configuration');
  return url.origin;
}
function originList(value: string | undefined, production: boolean): string[] {
  if (!value?.trim()) return [];
  return value.split(',').map((entry) => {
    const clean = entry.trim();
    const url = new URL(clean);
    if (url.pathname !== '/')
      throw new Error('security allowlists require exact origins');
    return origin(clean, 'http', production);
  });
}
/** Closed resource allowlist. No environment URL is printed or reflected without validation. */
export function securityHeaders(
  config: SecurityOrigins,
  nonce: string,
): Record<string, string> {
  if (!/^[A-Za-z0-9+/=_-]{16,128}$/.test(nonce))
    throw new Error('invalid security nonce');
  const api = config.api ? [origin(config.api, 'http', config.production)] : [];
  const ws = config.ws ? [origin(config.ws, 'ws', config.production)] : [];
  const media = originList(config.media, config.production);
  const telemetry = originList(config.telemetry, config.production);
  const list = (values: string[]) => [...new Set(values)].join(' ');
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${config.production ? '' : " 'unsafe-eval'"}`,
    // Motion and measured Studio transforms require inline style attributes, not inline scripts.
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${list(["'self'", ...api, ...ws, ...media, ...telemetry])}`,
    `img-src ${list(["'self'", 'data:', 'blob:', ...api, ...media])}`,
    `media-src ${list(["'self'", 'blob:', ...api, ...media])}`,
    "font-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': policy,
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), fullscreen=(self), clipboard-write=(self), web-share=(self)',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
  };
}
