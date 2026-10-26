import { KimoClient } from '@kimo/client';
export const api = new KimoClient(
  process.env.NEXT_PUBLIC_KIMO_API ?? 'http://localhost:8787',
);
