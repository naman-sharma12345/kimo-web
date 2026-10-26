import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingPage } from './landing-page';
import { ToastProvider } from '@/components/ui/toast';
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  startSession: vi.fn(),
  add: vi.fn(() => []),
  cancel: vi.fn(),
  save: vi.fn(),
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
