import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Render, SessionSnapshot } from '@kimo/client';
import type { RenderApi } from '@/lib/render/lifecycle';
import { RenderScreen } from './render-screen';
const mocks = vi.hoisted(() => ({ replace: vi.fn(), reduced: false }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => mocks.reduced,
}));
const snapshot: SessionSnapshot = {
  status: 'rendering',
  renderId: 'actual-job',
  assets: [],
  project: {
    id: 'project',
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    duration: 8,
    tracks: [],
    clips: {},
    markers: [],
  },
};
const value: Render = {
  status: 'rendering',
  progress: 0.5,
  frame: 0,
  totalFrames: 240,
  etaSec: 4,
  fps: 30,
  chunkIndex: 2,
};
function client(value: Render): RenderApi {
  return {
    render: vi.fn(async () => value),
    session: vi.fn(async () => ({ ...snapshot, status: 'editing' as const })),
    renderFrameUrl: vi.fn(() => '/frame.jpg'),
    cancelRender: vi.fn(async () => ({
      status: 'cancelled' as const,
      sessionId: 'session/id',
    })),
    reopenSession: vi.fn(async () => ({ status: 'editing' as const })),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.replace.mockClear();
  mocks.reduced = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
describe('render scene controller integration', () => {
  it.each([false, true])(
    'routes once after exact completion delay, reduced=%s',
    async (reduced) => {
      mocks.reduced = reduced;
      const api = client({ ...value, status: 'done', videoId: 'actual/video' });
      const view = render(
        <RenderScreen sessionId="session/id" snapshot={snapshot} api={api} />,
      );
      await act(async () => {});
      expect(api.render).toHaveBeenCalledWith('actual-job', {
        signal: expect.any(AbortSignal),
      });
      const delay = reduced ? 220 : 1400;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay - 1);
      });
      expect(mocks.replace).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(mocks.replace).toHaveBeenCalledWith('/v/actual%2Fvideo');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(mocks.replace).toHaveBeenCalledOnce();
      expect(sessionStorage.getItem('kimo-render-arrival:actual/video')).toBe(
        '1',
      );
      view.unmount();
    },
  );
  it('does not fabricate a delivery id, or call cancel on unmount', async () => {
    const api = client({ ...value, status: 'done' });
    const view = render(
      <RenderScreen sessionId="s" snapshot={snapshot} api={api} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByText(/without a video identifier/)).toBeTruthy();
    view.unmount();
    expect(api.cancelRender).not.toHaveBeenCalled();
  });
  it('confirms actual-job cancellation and reconciles before studio navigation', async () => {
    const api = client(value);
    render(
      <RenderScreen sessionId="session/id" snapshot={snapshot} api={api} />,
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'back to editing' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'cancel render' }));
    });
    expect(api.cancelRender).toHaveBeenCalledOnce();
    expect(api.cancelRender).toHaveBeenCalledWith('actual-job', {
      signal: expect.any(AbortSignal),
    });
    expect(api.session).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith('/studio/session%2Fid');
  });
  it('failed retry returns to explicit parent review without a new approval POST', async () => {
    const api = client({
      ...value,
      status: 'failed',
      error: { message: 'actual producer error' },
    });
    render(
      <RenderScreen sessionId="session/id" snapshot={snapshot} api={api} />,
    );
    await act(async () => {});
    expect(screen.getByText('the render hit a problem')).toBeTruthy();
    expect(screen.getByText('actual producer error')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'try again' }));
    });
    expect(api.reopenSession).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith(
      '/studio/session%2Fid?review=render',
    );
  });
  it('network read failure is not job failure and retains last authoritative progress', async () => {
    const api = client(value);
    const read = vi.mocked(api.render);
    read.mockResolvedValueOnce(value).mockRejectedValue(Error('offline'));
    render(<RenderScreen sessionId="s" snapshot={snapshot} api={api} />);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '50',
    );
    expect(screen.queryByText('the render hit a problem')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(
      'connection interrupted',
    );
  });
});
