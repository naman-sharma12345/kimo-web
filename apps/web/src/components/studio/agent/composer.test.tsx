import * as React from 'react';
import { createRef } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { AgentComposer } from './composer';
import type { AgentComposerHandle, AgentComposerProps } from './composer';
afterEach(cleanup);
function setup(extra: Partial<AgentComposerProps> = {}) {
  const props = {
    clips: [],
    onSend: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onUndoLast: vi.fn(),
    onRender: vi.fn(),
    ...extra,
  };
  const ref = createRef<AgentComposerHandle>();
  const view = render(<AgentComposer ref={ref} {...props} />);
  const prefill = (text: string) => act(() => ref.current?.prefill(text));
  return { props, ref, prefill, ...view };
}
describe('injected composer', () => {
  it.each([
    ['/pause', 'onPause'],
    ['/resume', 'onResume'],
    ['/undo-last', 'onUndoLast'],
    ['/render', 'onRender'],
  ] as const)(
    'dispatches %s only through its actual callback',
    async (command, callback) => {
      const { props, prefill } = setup();
      prefill(command);
      fireEvent.click(screen.getByRole('button', { name: 'send' }));
      await waitFor(() => expect(props[callback]).toHaveBeenCalledTimes(1));
      expect(props.onSend).not.toHaveBeenCalled();
    },
  );
  it('sends unknown slash as ordinary text and prevents duplicate in-flight sends', async () => {
    let finish: () => void = () => {};
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { ref, prefill } = setup({ onSend: send });
    prefill('/unknown note');
    act(() => {
      ref.current?.submit();
      ref.current?.submit();
    });
    expect(send).toHaveBeenCalledExactlyOnceWith({ text: '/unknown note' });
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
    await act(async () => {
      finish();
    });
    expect(screen.getByRole('textbox')).toBeEmptyDOMElement();
  });
  it('never clears a newer draft after the old send finishes', async () => {
    let finish: () => void = () => {};
    const { prefill, ref } = setup({
      onSend: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    prefill('old');
    act(() => ref.current?.submit());
    prefill('new');
    await act(async () => finish());
    expect(screen.getByRole('textbox')).toHaveTextContent('new');
  });
  it('keeps rejected content editable and reports the actual error', async () => {
    const status = vi.fn();
    const { prefill } = setup({
      onSend: () => Promise.reject(new Error('connection unavailable')),
      onStatus: status,
    });
    prefill('keep this');
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'connection unavailable',
    );
    expect(screen.getByRole('textbox')).toHaveTextContent('keep this');
    expect(status).toHaveBeenCalledWith('connection unavailable');
  });
  it('disables pending/failed uploads, shows actual asset metadata, and removes via injected callback', () => {
    const remove = vi.fn();
    const { prefill, rerender, props } = setup({
      attachments: [
        { id: 'upload1', name: 'real.mov', status: 'uploading', progress: 42 },
      ],
      onRemoveAttachment: remove,
    });
    prefill('send');
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '42');
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'remove real.mov' }));
    expect(remove).toHaveBeenCalledWith('upload1');
    rerender(
      <AgentComposer
        {...props}
        attachments={[{ id: 'upload1', name: 'real.mov', status: 'failed' }]}
      />,
    );
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
    expect(screen.getByText('upload failed')).toBeInTheDocument();
  });
  it('sends actual asset IDs once and does not swallow attached slash text', async () => {
    const asset = {
      id: 'asset-actual',
      kind: 'video' as const,
      name: 'actual.mov',
      url: '/actual.mov',
      thumbUrl: '/actual.jpg',
      source: 'user' as const,
    };
    const { prefill, props } = setup({
      attachments: [{ id: 'local', name: 'upload', status: 'ready', asset }],
    });
    expect(screen.getByAltText('')).toHaveAttribute('src', '/actual.jpg');
    expect(screen.getByText('actual.mov')).toBeInTheDocument();
    prefill('/pause');
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() =>
      expect(props.onSend).toHaveBeenCalledExactlyOnceWith({
        text: '/pause',
        attachmentIds: ['asset-actual'],
      }),
    );
    expect(props.onPause).not.toHaveBeenCalled();
  });
  it('uses working/stopped copy and never steals orange from another owner', () => {
    const { rerender, props } = setup({ working: true, orangeOwner: 'other' });
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'data-placeholder',
      'type to interrupt kimo…',
    );
    expect(
      screen.getByText(
        'kimo will stop after the current step and read your note',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'send' })).toHaveAttribute(
      'data-primary',
      'false',
    );
    rerender(<AgentComposer {...props} stopped />);
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'data-placeholder',
      'tell kimo what to do next…',
    );
  });
  it('uploads real File objects and resets file input', async () => {
    const upload = vi.fn();
    setup({ onUpload: upload });
    const file = new File(['actual'], 'actual.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('attach files'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(upload).toHaveBeenCalledExactlyOnceWith([file]));
  });
});
