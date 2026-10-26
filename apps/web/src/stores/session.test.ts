import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionDraft } from './session';
const draft: SessionDraft = {
  sessionId: 's1',
  wsUrl: 'ws://localhost/live',
  prompt: 'exact prompt',
  assetLocalMap: { local: 'asset' },
};
afterEach(() => {
  vi.unstubAllGlobals();
  useSession.setState({ draft: null });
  sessionStorage.clear();
});
describe('session draft persistence', () => {
  it('preserves a live accepted session when storage rejects writes', () => {
    vi.stubGlobal('sessionStorage', {
      setItem: () => {
        throw new DOMException('denied');
      },
    });
    expect(() => useSession.getState().save(draft)).not.toThrow();
    expect(useSession.getState().draft).toEqual(draft);
  });
  it('returns null when storage rejects reads', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new DOMException('denied');
      },
    });
    expect(useSession.getState().restore()).toBeNull();
  });
  it('restores exact prompt and valid attachment mappings', () => {
    useSession.getState().save(draft);
    useSession.setState({ draft: null });
    expect(useSession.getState().restore()).toEqual(draft);
  });
  it('ignores malformed saved records', () => {
    sessionStorage.setItem('kimo-session', '{broken');
    expect(useSession.getState().restore()).toBeNull();
  });
});
