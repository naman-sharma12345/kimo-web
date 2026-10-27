import * as React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KimoProject } from '@kimo/client';
import {
  ReviewPrompt,
  ActingRenderDialog,
  ReviewDialog,
  reviewFormat,
  reviewLength,
  type PosterResult,
} from './index';
const project: KimoProject = {
  id: 'actual-project',
  version: 12,
  duration: 42.5,
  width: 1080,
  height: 1920,
  fps: 30,
  tracks: [
    {
      id: 'text',
      name: 'text',
      kind: 'text',
      height: 64,
      hidden: false,
      muted: false,
      locked: false,
    },
  ],
  clips: {},
  markers: [],
};
const text = (
  style: 'title-serif' | 'caption-clean',
): KimoProject['clips'][string] => ({
  id: 'text',
  trackId: 'text',
  kind: 'text',
  start: 0,
  duration: 42.5,
  in: 0,
  speed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  effects: [],
  keyframes: [],
  text: { content: 'actual text', style },
});
const defaults = () => ({
  open: true,
  project,
  title: 'actual project title',
  ready: true,
  onOpenChange: vi.fn(),
  onKeepEditing: vi.fn(),
  onRender: vi.fn(),
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('review prompt', () => {
  it('holds the three-second visibility budget on hover and keyboard focus; watches through parent callback', () => {
    vi.useFakeTimers();
    const watch = vi.fn();
    const view = render(<ReviewPrompt requestId="review-1" onWatch={watch} />);
    const play = screen.getByRole('button', { name: 'watch the first cut' });
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.mouseEnter(play);
    act(() => vi.advanceTimersByTime(6000));
    expect(play.parentElement).toHaveAttribute('data-visible', 'true');
    fireEvent.focus(play);
    fireEvent.mouseLeave(play);
    act(() => vi.advanceTimersByTime(6000));
    expect(play.parentElement).toHaveAttribute('data-visible', 'true');
    fireEvent.click(play);
    expect(watch).toHaveBeenCalledOnce();
    view.rerender(<ReviewPrompt requestId="review-2" onWatch={watch} />);
    expect(
      screen.getByRole('button', { name: 'watch the first cut' }).parentElement,
    ).toHaveAttribute('data-visible', 'true');
    act(() => vi.advanceTimersByTime(3000));
    expect(
      screen.queryByRole('button', { name: 'watch the first cut' }),
    ).not.toBeInTheDocument();
  });
  it('does not restart on rerender of the same request', () => {
    vi.useFakeTimers();
    const props = { requestId: 7, onWatch: vi.fn() };
    const view = render(<ReviewPrompt {...props} />);
    act(() => vi.advanceTimersByTime(2000));
    view.rerender(<ReviewPrompt {...props} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
describe('acting confirmation', () => {
  it('uses the exact recorded summary and emits intent only', () => {
    const now = vi.fn(),
      finish = vi.fn();
    render(
      <ActingRenderDialog
        open
        currentGroupSummary="cut the intro"
        onOpenChange={vi.fn()}
        onRenderNow={now}
        onLetFinish={finish}
      />,
    );
    expect(
      screen.getByText(
        'kimo is still working on: cut the intro. you can render now or let it finish.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'render now' }));
    expect(now).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'let kimo finish' }));
    expect(finish).toHaveBeenCalledOnce();
  });
  it('does not fabricate an unavailable summary and respects parent readiness', () => {
    render(
      <ActingRenderDialog
        open
        currentGroupSummary={null}
        ready={false}
        onOpenChange={vi.fn()}
        onRenderNow={vi.fn()}
        onLetFinish={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/current group summary unavailable/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'render now' })).toBeDisabled();
  });
});
describe('review dialog', () => {
  it('uses actual length/aspect and actual caption classification, emits version/title/options', () => {
    const props = defaults();
    render(
      <ReviewDialog
        {...props}
        project={{ ...project, clips: { text: text('caption-clean') } }}
      />,
    );
    expect(screen.getByText('ready to render?')).toBeInTheDocument();
    expect(screen.getByText('0:42')).toBeInTheDocument();
    expect(screen.getByText('1080p · 9:16 · 30 fps · mp4')).toBeInTheDocument();
    expect(screen.getByText('stereo · 48 kHz')).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'burn in captions' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'render 1080p' }));
    expect(props.onRender).toHaveBeenCalledWith({
      title: 'actual project title',
      burnInCaptions: false,
      expectedProjectVersion: 12,
    });
    fireEvent.click(screen.getByRole('button', { name: 'keep editing' }));
    expect(props.onKeepEditing).toHaveBeenCalledOnce();
  });
  it('title text is not a caption; unavailable capture does not fabricate a poster or block ready approval', async () => {
    const props = defaults();
    render(
      <ReviewDialog
        {...props}
        project={{ ...project, clips: { text: text('title-serif') } }}
        getFrame={vi.fn().mockRejectedValue(new Error('GPU unavailable'))}
      />,
    );
    await screen.findByText('poster unavailable');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'render 1080p' })).toBeEnabled();
  });
  it('disables submission for not-ready or pending state', () => {
    const props = defaults();
    const view = render(<ReviewDialog {...props} ready={false} />);
    expect(screen.getByRole('button', { name: 'render 1080p' })).toBeDisabled();
    view.rerender(<ReviewDialog {...props} pending />);
    expect(screen.getByRole('button', { name: 'render 1080p' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'keep editing' })).toBeDisabled();
  });
  it('captures only once under StrictMode and revokes/aborts on close', async () => {
    const props = defaults();
    const result: PosterResult = {
      blob: new Blob(['actual pixels'], { type: 'image/png' }),
      projectVersion: 12,
      time: 1,
      width: 360,
      height: 640,
      approximations: [],
    };
    const create = vi.fn(() => 'blob:actual'),
      revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    const getFrame = vi.fn(async () => result);
    const poster = vi.fn();
    const view = render(
      <React.StrictMode>
        <ReviewDialog {...props} getFrame={getFrame} onPoster={poster} />
      </React.StrictMode>,
    );
    await screen.findByRole('img', {
      name: 'current frame of actual project title',
    });
    expect(getFrame).toHaveBeenCalledOnce();
    expect(getFrame).toHaveBeenCalledWith(1, {
      signal: expect.any(AbortSignal),
    });
    expect(poster).toHaveBeenCalledWith(result);
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:actual');
    vi.unstubAllGlobals();
  });
  it('aborts stale project captures and rejects a mismatched returned version', async () => {
    let done: ((value: PosterResult) => void) | undefined;
    let signal: AbortSignal | undefined;
    const getFrame = vi.fn(
      (_time: number, options?: { signal?: AbortSignal }) => {
        signal = options?.signal;
        return new Promise<PosterResult>((resolve) => {
          done = resolve;
        });
      },
    );
    const props = defaults();
    const view = render(<ReviewDialog {...props} getFrame={getFrame} />);
    await waitFor(() => expect(getFrame).toHaveBeenCalledOnce());
    const oldSignal = signal;
    view.rerender(<ReviewDialog {...props} open={false} getFrame={getFrame} />);
    expect(oldSignal?.aborted).toBe(true);
    await act(async () =>
      done?.({
        blob: new Blob(['old']),
        projectVersion: 11,
        time: 1,
        width: 10,
        height: 10,
        approximations: [],
      }),
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('formats square and long duration without example data', () => {
    expect(reviewFormat({ width: 1080, height: 1080 })).toBe(
      '1080p · 1:1 · 30 fps · mp4',
    );
    expect(reviewLength(125)).toBe('2:05');
  });
});

describe('poster callback identity and mismatch boundaries', () => {
  it('does not reacquire capture on ordinary parent rerenders with inline callbacks', async () => {
    const props = defaults();
    let signal: AbortSignal | undefined;
    const getFrame = vi.fn(
      (_time: number, options?: { signal?: AbortSignal }) => {
        signal = options?.signal;
        return new Promise<PosterResult>(() => undefined);
      },
    );
    const view = render(
      <ReviewDialog
        {...props}
        getFrame={(time, options) => getFrame(time, options)}
      />,
    );
    await waitFor(() => expect(getFrame).toHaveBeenCalledOnce());
    view.rerender(
      <ReviewDialog
        {...props}
        getFrame={(time, options) => getFrame(time, options)}
      />,
    );
    await act(async () => undefined);
    expect(getFrame).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it('rejects wrong-version poster bytes while dialog remains open', async () => {
    render(
      <ReviewDialog
        {...defaults()}
        getFrame={async () => ({
          blob: new Blob(['old'], { type: 'image/png' }),
          projectVersion: 11,
          time: 1,
          width: 640,
          height: 360,
          approximations: [],
        })}
      />,
    );
    await screen.findByText('poster unavailable');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
