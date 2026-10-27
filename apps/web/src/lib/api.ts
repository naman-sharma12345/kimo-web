import { KimoClient } from '@kimo/client';
// SSR may reach the same typed service over a private runner-local route.
// Unprefixed environment variables are never bundled as browser configuration.
const internalBase =
  typeof window === 'undefined' ? process.env.KIMO_API_INTERNAL_URL : undefined;
export const api = new KimoClient(
  internalBase ?? process.env.NEXT_PUBLIC_KIMO_API ?? 'http://localhost:8787',
);
