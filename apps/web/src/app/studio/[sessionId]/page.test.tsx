import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type SessionSnapshot } from '@kimo/client';
import { renderToStaticMarkup } from 'react-dom/server';
import StudioPage from './page';
import { SessionRestoreError, StudioRestoreBoundary } from './restore-boundary';
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('not-found');
  }),
}));
vi.mock('@/lib/api', () => ({ api: { session: mocks.session } }));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));
function snapshot(status: SessionSnapshot['status']): SessionSnapshot {
  return {
    status,
    project: {
      id: 'p',
      version: 1,
      fps: 30,
      width: 1920,
      height: 1080,
      duration: 0,
      tracks: [],
      clips: {},
      markers: [],
    },
    assets: [],
  };
}
const params = Promise.resolve({ sessionId: 'deep/link' });
beforeEach(() => vi.clearAllMocks());
describe('Phase 3 Studio REST restore boundary', () => {
  it.each([
    ['warming', '/warmup/deep%2Flink'],
    ['rendering', '/render/deep%2Flink'],
  ] as const)(
    'redirects %s from the authoritative snapshot',
    async (status, href) => {
      mocks.session.mockResolvedValue(snapshot(status));
      await expect(StudioPage({ params })).rejects.toThrow(`redirect:${href}`);
      expect(mocks.session).toHaveBeenCalledWith('deep/link');
    },
  );
  it('redirects finished sessions to the returned video id', async () => {
    mocks.session.mockResolvedValue({
      ...snapshot('done'),
      videoId: 'video/id',
    });
    await expect(StudioPage({ params })).rejects.toThrow(
      'redirect:/v/video%2Fid',
    );
  });
  it.each(['editing', 'awaiting_review'] as const)(
    'restores %s without inventing an editor',
    async (status) => {
      mocks.session.mockResolvedValue(snapshot(status));
      const page = await StudioPage({ params });
      expect(page.type).toBe(StudioRestoreBoundary);
      const markup = renderToStaticMarkup(page);
      expect(markup).toContain(
        'the editing interface is not implemented in this build.',
      );
      expect(markup).toContain('project version');
    },
  );
  it('shows the exact session error variant for failed sessions', async () => {
    mocks.session.mockResolvedValue(snapshot('failed'));
    const page = await StudioPage({ params });
    expect(page.type).toBe(SessionRestoreError);
  });
  it('does not invent a video URL when a done snapshot has no videoId', async () => {
    mocks.session.mockResolvedValue(snapshot('done'));
    expect((await StudioPage({ params })).type).toBe(SessionRestoreError);
  });
  it('uses the nested exact-copy not-found route only for REST 404', async () => {
    mocks.session.mockRejectedValue(new ApiError(404, 'missing'));
    await expect(StudioPage({ params })).rejects.toThrow('not-found');
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });
  it('other REST failures remain retryable rather than appearing as missing sessions', async () => {
    mocks.session.mockRejectedValue(new ApiError(503, 'unavailable'));
    const page = await StudioPage({ params });
    expect(page.type).toBe(SessionRestoreError);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
