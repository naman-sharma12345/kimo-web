import type { SessionSnapshot } from '@kimo/client';
import type { UploadSession } from './types';
export const SESSION_STORAGE_KEY = 'kimo.upload-session.v1';
export function persistSession(session: UploadSession): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* Restricted storage must not lose the live session. */
  }
}
export function restoreUploadSession(): UploadSession | undefined {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const raw: unknown = JSON.parse(
      sessionStorage.getItem(SESSION_STORAGE_KEY) ?? 'null',
    );
    if (!raw || typeof raw !== 'object') return;
    const value = raw as Partial<UploadSession>;
    if (
      typeof value.sessionId !== 'string' ||
      typeof value.wsUrl !== 'string' ||
      typeof value.prompt !== 'string' ||
      !value.assetLocalMap ||
      typeof value.assetLocalMap !== 'object' ||
      !Object.values(value.assetLocalMap).every(
        (id) => typeof id === 'string',
      ) ||
      !Array.isArray(value.attachments)
    )
      return;
    if (
      !value.attachments.every((a: unknown) => {
        if (!a || typeof a !== 'object') return false;
        const item = a as Record<string, unknown>;
        return (
          typeof item.localId === 'string' &&
          typeof item.assetId === 'string' &&
          typeof item.name === 'string' &&
          typeof item.size === 'number' &&
          ['video', 'image', 'audio', 'doc'].includes(String(item.kind))
        );
      })
    )
      return;
    return value as UploadSession;
  } catch {
    return;
  }
}
export type SessionDestination =
  { kind: 'redirect'; href: string } | { kind: 'studio' } | { kind: 'error' };
export function sessionDestination(
  id: string,
  snapshot: SessionSnapshot,
): SessionDestination {
  const encoded = encodeURIComponent(id);
  switch (snapshot.status) {
    case 'warming':
      return { kind: 'redirect', href: `/warmup/${encoded}` };
    case 'rendering':
      return { kind: 'redirect', href: `/render/${encoded}` };
    case 'done':
      return snapshot.videoId
        ? {
            kind: 'redirect',
            href: `/v/${encodeURIComponent(snapshot.videoId)}`,
          }
        : { kind: 'error' };
    case 'failed':
      return snapshot.renderId
        ? { kind: 'redirect', href: `/render/${encoded}` }
        : { kind: 'error' };
    default:
      return { kind: 'studio' };
  }
}
