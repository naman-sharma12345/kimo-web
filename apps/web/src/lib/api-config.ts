import {
  KimoConfigurationError,
  parseApiBase,
  parseWsOrigin,
} from '@kimo/client';
export interface PublicApiConfigInput {
  mode: string | undefined;
  api: string | undefined;
  ws: string | undefined;
}
export function resolvePublicApiConfig(input: PublicApiConfigInput) {
  const production = input.mode === 'production';
  if (production && !input.api)
    throw new KimoConfigurationError('NEXT_PUBLIC_KIMO_API');
  if (production && !input.ws)
    throw new KimoConfigurationError('NEXT_PUBLIC_KIMO_WS');
  const apiBase = parseApiBase(input.api ?? 'http://localhost:8787');
  const wsOrigin = input.ws === undefined ? undefined : parseWsOrigin(input.ws);
  if (production && !apiBase.startsWith('https:'))
    throw new KimoConfigurationError('NEXT_PUBLIC_KIMO_API');
  if (production && !wsOrigin?.startsWith('wss:'))
    throw new KimoConfigurationError('NEXT_PUBLIC_KIMO_WS');
  return { apiBase, wsOrigin };
}
export function readPublicApiConfig() {
  return resolvePublicApiConfig({
    mode: process.env.NODE_ENV,
    api: process.env.NEXT_PUBLIC_KIMO_API,
    ws: process.env.NEXT_PUBLIC_KIMO_WS,
  });
}
