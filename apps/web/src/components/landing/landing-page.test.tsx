import * as React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { durations } from '@/lib/motion';
import { LandingPage } from './landing-page';
import { LandingBootstrap } from './landing-bootstrap';
import { ToastProvider } from '@/components/ui/toast';
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  startSession: vi.fn(),
  add: vi.fn(() => []),
  cancel: vi.fn(),
  save: vi.fn(),
  reduced: false,
}));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => mocks.reduced,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/uploads', () => ({
  persistSession: vi.fn(),
  useUploads: Object.assign(() => [], {
    getState: () => ({
      items: [],
      startSession: mocks.startSession,
      add: mocks.add,
      cancel: mocks.cancel,
    }),
    setState: vi.fn(),
  }),
}));
vi.mock('@/stores/session', () => ({
  useSession: { getState: () => ({ save: mocks.save }), setState: vi.fn() },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.reduced = false;
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  mocks.startSession.mockRejectedValue(new Error('offline'));
});
describe('landing interactions', () => {
  it('shows the exact privacy warning and real policy link', () => {
    render(
      <ToastProvider>
        <LandingPage />
      </ToastProvider>,
    );
    expect(
      screen.getByText(
        /by sending, you agree that your files are processed by ai models\. don’t upload anything private\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'privacy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  it('sample chips fill but do not send', () => {
    render(
      <ToastProvider>
        <LandingPage />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'podcast to shorts' }));
    expect(
      screen.getByRole('textbox', { name: 'describe your video' }),
    ).toHaveValue('turn this podcast clip into three vertical shorts');
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
  it('Shift+Enter does not send, Enter creates once, and failure retains text', async () => {
    render(
      <ToastProvider>
        <LandingPage />
      </ToastProvider>,
    );
    const editor = screen.getByRole('textbox', { name: 'describe your video' });
    fireEvent.change(editor, { target: { value: 'keep my prompt' } });
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    expect(mocks.startSession).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'couldn’t start a session. your files are still here, try again.',
      ),
    );
    expect(mocks.startSession).toHaveBeenCalledTimes(1);
    expect(editor).toHaveValue('keep my prompt');
  });
  it('unsupported attachments are rejected before the manager receives them', async () => {
    render(
      <ToastProvider>
        <LandingPage />
      </ToastProvider>,
    );
    const picker = screen.getByLabelText('attach files', { selector: 'input' });
    fireEvent.change(picker, {
      target: {
        files: [
          new File(['x'], 'bad.exe', { type: 'application/octet-stream' }),
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'bad.exe can’t be used: that file type isn’t supported yet',
      ),
    );
    expect(mocks.add).not.toHaveBeenCalled();
  });
});

const originalTransition = Object.getOwnPropertyDescriptor(
  document,
  'startViewTransition',
);
afterEach(() => {
  vi.useRealTimers();
  if (originalTransition)
    Object.defineProperty(document, 'startViewTransition', originalTransition);
  else Reflect.deleteProperty(document, 'startViewTransition');
});
describe('landing navigation safety', () => {
  async function start() {
    mocks.startSession.mockResolvedValue({
      sessionId: 'session/id',
      wsUrl: 'ws://test',
      prompt: 'test',
    });
    const view = render(
      <ToastProvider>
        <LandingPage />
      </ToastProvider>,
    );
    fireEvent.change(
      screen.getByRole('textbox', { name: 'describe your video' }),
      { target: { value: 'test' } },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'start editing' }));
    });
    return view;
  }
  function stall() {
    let callback = () => {};
    const native = vi.fn((update: () => void) => {
      callback = update;
      const pending = new Promise<void>(() => {});
      return { ready: pending, updateCallbackDone: pending, finished: pending };
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: native,
    });
    return { native, late: () => callback() };
  }
  it('pushes once after the existing exit and bounded fallback despite a stalled native callback', async () => {
    vi.useFakeTimers();
    const transition = stall();
    await start();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(durations.d5 * 1000);
    });
    expect(transition.native).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(durations.d3 * 1000);
    });
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/warmup/session%2Fid');
    transition.late();
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
  it('cancels pending navigation on unmount', async () => {
    vi.useFakeTimers();
    const transition = stall();
    const view = await start();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(durations.d5 * 1000);
    });
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(durations.d3 * 1000);
    });
    transition.late();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('does not schedule a transition if unmounted during the existing exit delay', async () => {
    vi.useFakeTimers();
    const transition = stall();
    const view = await start();
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync((durations.d5 + durations.d3) * 1000);
    });
    expect(transition.native).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('bypasses native animation for reduced motion', async () => {
    vi.useFakeTimers();
    mocks.reduced = true;
    const transition = stall();
    await start();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(durations.d3 * 1000);
    });
    expect(transition.native).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/warmup/session%2Fid');
  });
});

describe('activated landing handoff', () => {
  it('hands real bootstrap input and files to the real page and sends only once', async () => {
    let resolve: (components: {
      Page: typeof LandingPage;
      Providers: typeof ToastProvider;
    }) => void = () => {};
    const pending = new Promise<{
      Page: typeof LandingPage;
      Providers: typeof ToastProvider;
    }>((yes) => {
      resolve = yes;
    });
    const load = vi.fn(() => pending);
    render(<LandingBootstrap loadInteraction={load} />);
    const editor = screen.getByRole('textbox', { name: 'describe your video' });
    editor.focus();
    fireEvent.change(editor, { target: { value: 'first and final text' } });
    const file = new File(['video'], 'handoff.mp4', { type: 'video/mp4' });
    fireEvent.drop(window, { dataTransfer: { files: [file] } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(mocks.startSession).not.toHaveBeenCalled();
    await act(async () =>
      resolve({ Page: LandingPage, Providers: ToastProvider }),
    );
    await waitFor(() => expect(mocks.startSession).toHaveBeenCalledTimes(1));
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith([file]);
    expect(mocks.startSession).toHaveBeenCalledWith({
      prompt: 'first and final text',
      aspect: 'auto',
    });
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('removes bootstrap global handlers after handoff so paste and keyboard events are not doubled', async () => {
    render(
      <LandingBootstrap
        loadInteraction={async () => ({
          Page: LandingPage,
          Providers: ToastProvider,
        })}
      />,
    );
    await act(async () =>
      fireEvent.change(
        screen.getByRole('textbox', { name: 'describe your video' }),
        { target: { value: 'hello' } },
      ),
    );
    const file = new File(['video'], 'after.mp4', { type: 'video/mp4' });
    fireEvent.paste(window, { clipboardData: { files: [file] } });
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith([file]);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
  it('keeps initial image previews valid across StrictMode rehearsal and revokes on real unmount', async () => {
    const create = vi.fn(() => 'blob:handoff');
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    const view = render(
      <React.StrictMode>
        <ToastProvider>
          <LandingPage activated initialFiles={[file]} />
        </ToastProvider>
      </React.StrictMode>,
    );
    await act(async () => {});
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => {});
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:handoff');
    vi.unstubAllGlobals();
  });
  it('restores prompt and selection without an activation POST or entrance replay', () => {
    const { container } = render(
      <ToastProvider>
        <LandingPage
          activated
          initialPrompt="keep this selection"
          initialFocus={{
            name: 'describe your video',
            start: 2,
            end: 7,
            direction: 'backward',
            scrollTop: 0,
          }}
        />
      </ToastProvider>,
    );
    const editor = screen.getByRole('textbox', {
      name: 'describe your video',
    }) as HTMLTextAreaElement;
    expect(editor).toHaveValue('keep this selection');
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(2);
    expect(editor.selectionEnd).toBe(7);
    expect(editor.selectionDirection).toBe('backward');
    expect(container.querySelector('.landing-page')).toHaveAttribute(
      'data-activated',
      'true',
    );
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
  it('imports attachments once and executes an explicit valid send once under StrictMode', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    render(
      <React.StrictMode>
        <ToastProvider>
          <LandingPage
            activated
            initialPrompt="my clip"
            initialFiles={[file]}
            initialSend
          />
        </ToastProvider>
      </React.StrictMode>,
    );
    await waitFor(() => expect(mocks.startSession).toHaveBeenCalledTimes(1));
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith([file]);
    expect(mocks.startSession).toHaveBeenCalledWith({
      prompt: 'my clip',
      aspect: 'auto',
    });
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'describe your video' }),
      ).not.toBeDisabled(),
    );
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'describe your video' }),
    ).toHaveValue('my clip');
  });
  it('never submits an empty handoff intent or rejected-only attachments', async () => {
    const file = new File(['x'], 'bad.exe', {
      type: 'application/octet-stream',
    });
    render(
      <ToastProvider>
        <LandingPage activated initialFiles={[file]} initialSend />
      </ToastProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'bad.exe can’t be used',
      ),
    );
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
  it('opens the settings action that triggered activation', async () => {
    render(
      <ToastProvider>
        <LandingPage activated initialControl="aspect ratio: auto" />
      </ToastProvider>,
    );
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
  it('preserves sign-in activation and attachment validation feedback', async () => {
    render(
      <ToastProvider>
        <LandingPage
          activated
          initialSignIn
          initialErrors={[
            'bad.exe can’t be used: that file type isn’t supported yet',
          ]}
        />
      </ToastProvider>,
    );
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'accounts are coming soon.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'bad.exe can’t be used',
    );
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
});
