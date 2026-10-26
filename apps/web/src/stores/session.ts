import { create } from 'zustand';
export interface SessionDraft {
  sessionId: string;
  prompt: string;
  wsUrl: string;
  assetLocalMap: Record<string, string>;
}
export const useSession = create<{
  draft: SessionDraft | null;
  save: (draft: SessionDraft) => void;
  restore: () => SessionDraft | null;
}>((set) => ({
  draft: null,
  save: (draft) => {
    sessionStorage.setItem('kimo-session', JSON.stringify(draft));
    set({ draft });
  },
  restore: () => {
    const raw = sessionStorage.getItem('kimo-session');
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (
        typeof value === 'object' &&
        value !== null &&
        'sessionId' in value &&
        'prompt' in value &&
        'wsUrl' in value &&
        'assetLocalMap' in value &&
        typeof value.sessionId === 'string' &&
        typeof value.prompt === 'string' &&
        typeof value.wsUrl === 'string' &&
        typeof value.assetLocalMap === 'object' &&
        value.assetLocalMap !== null
      ) {
        const map: Record<string, string> = {};
        for (const [key, item] of Object.entries(value.assetLocalMap)) {
          if (typeof item === 'string') map[key] = item;
        }
        const draft = {
          sessionId: value.sessionId,
          prompt: value.prompt,
          wsUrl: value.wsUrl,
          assetLocalMap: map,
        };
        set({ draft });
        return draft;
      }
      return null;
    } catch {
      return null;
    }
  },
}));
