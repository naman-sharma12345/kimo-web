// next/headers is a Next-enforced server-component-only boundary.
import { headers } from 'next/headers';
import { KimoClient, KimoConfigurationError, parseApiBase } from '@kimo/client';
import { readPublicApiConfig } from './api-config';
export function createRequestApi(input: {
  publicBase: string;
  internalBase?: string;
  cookieOrigin?: string;
  cookie?: string | null;
  production?: boolean;
  request?: typeof fetch;
}): KimoClient {
  const base = parseApiBase(input.internalBase ?? input.publicBase);
  const target = new URL(base);
  if (
    input.production &&
    target.protocol !== 'https:' &&
    !(
      input.internalBase &&
      ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    )
  )
    throw new KimoConfigurationError('KIMO_API_INTERNAL_URL');
  if (input.cookieOrigin) {
    const approved = parseApiBase(input.cookieOrigin);
    if (approved !== target.origin)
      throw new KimoConfigurationError('KIMO_SSR_COOKIE_ORIGIN');
  }
  const request = input.request ?? globalThis.fetch.bind(globalThis);
  const scoped: typeof fetch = (url, init) => {
    const destination = new URL(url instanceof Request ? url.url : String(url));
    if (destination.origin !== target.origin)
      throw new KimoConfigurationError('SSR API destination');
    const outgoing = new Headers(init?.headers);
    outgoing.delete('Cookie');
    if (input.cookieOrigin && input.cookie)
      outgoing.set('Cookie', input.cookie);
    return request(url, {
      ...init,
      headers: outgoing,
      cache: 'no-store',
      redirect: 'error',
    });
  };
  return new KimoClient(base, scoped);
}
export async function createServerApi(): Promise<KimoClient> {
  if (typeof window !== 'undefined')
    throw new KimoConfigurationError('server API context');
  const config = readPublicApiConfig();
  const incoming = await headers();
  return createRequestApi({
    publicBase: config.apiBase,
    internalBase: process.env.KIMO_API_INTERNAL_URL,
    cookieOrigin: process.env.KIMO_SSR_COOKIE_ORIGIN,
    cookie: incoming.get('cookie'),
    production: process.env.NODE_ENV === 'production',
  });
}
