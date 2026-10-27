import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { LandingBootstrap } from './landing-bootstrap';
import type { LandingPageProps } from './landing-page';

let received: LandingPageProps | undefined;
function Page(props: LandingPageProps) {
  received = props;
  return <div data-testid="interactive">interactive editor</div>;
}
function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
function setup() {
  let resolve: (value: {
    Page: typeof Page;
    Providers: typeof Providers;
  }) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<{
    Page: typeof Page;
    Providers: typeof Providers;
  }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const load = vi.fn(() => promise);
  const view = render(<LandingBootstrap loadInteraction={load} />);
  return {
    ...view,
    load,
    ready: async () => {
      await act(async () => resolve({ Page, Providers }));
    },
    fail: async () => {
      await act(async () => reject(new Error('offline')));
    },
  };
}
function editor() {
  return screen.getByRole('textbox', {
    name: 'describe your video',
  }) as HTMLTextAreaElement;
}
beforeEach(() => {
  received = undefined;
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: () => '220ms',
  }));
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:test');
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('lightweight landing bootstrap', () => {
  it('keeps the full copy, brand, navigation, privacy and layout without loading on mount, idle or focus', async () => {
    vi.useFakeTimers();
    const { load, container } = setup();
    expect(screen.getByText('tell it the video.')).toBeInTheDocument();
    expect(
      screen.getByText(/drop in your clips, photos and music/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'privacy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(
      screen.getByText(
        /by sending, you agree that your files are processed by ai models/,
      ),
    ).toHaveTextContent('don’t upload anything private.');
    expect(screen.getByRole('link', { name: 'how it works' })).toHaveAttribute(
      'href',
      '#how-it-works',
    );
    expect(container.querySelector('.brand svg')).toBeInTheDocument();
    expect(container.querySelectorAll('.how-grid article')).toHaveLength(3);
    fireEvent.focus(editor());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(load).not.toHaveBeenCalled();
  });
  it('programmatic desktop autofocus does not activate', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('pointer:fine'),
    }));
    const { load } = setup();
    expect(editor()).toHaveFocus();
    expect(load).not.toHaveBeenCalled();
  });
  it('keeps first and subsequent characters, selection, focus and scroll until ready; activation never sends', async () => {
    const view = setup();
    const input = editor();
    input.focus();
    fireEvent.change(input, { target: { value: 'first' } });
    expect(screen.getByRole('status')).toHaveTextContent('loading editor…');
    fireEvent.change(input, { target: { value: 'first and latest' } });
    input.setSelectionRange(2, 7, 'backward');
    input.scrollTop = 12;
    expect(view.load).toHaveBeenCalledTimes(1);
    await view.ready();
    expect(received).toMatchObject({
      initialPrompt: 'first and latest',
      initialSend: false,
      activated: true,
      initialFocus: {
        name: 'describe your video',
        start: 2,
        end: 7,
        direction: 'backward',
        scrollTop: 12,
      },
    });
  });
  it('sample chips fill and focus at the end but never send', async () => {
    const view = setup();
    fireEvent.click(screen.getByRole('button', { name: 'podcast to shorts' }));
    expect(editor()).toHaveValue(
      'turn this podcast clip into three vertical shorts',
    );
    expect(editor()).toHaveFocus();
    expect(editor().selectionStart).toBe(editor().value.length);
    await view.ready();
    expect(received).toMatchObject({
      initialPrompt: 'turn this podcast clip into three vertical shorts',
      initialSend: false,
    });
  });
  it('deduplicates activation and carries only an explicit valid send intent', async () => {
    const view = setup();
    fireEvent.keyDown(editor(), { key: 'Enter' });
    expect(view.load).not.toHaveBeenCalled();
    fireEvent.change(editor(), { target: { value: 'send this' } });
    fireEvent.keyDown(editor(), { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(editor(), { key: 'Enter', isComposing: true });
    expect(received).toBeUndefined();
    fireEvent.keyDown(editor(), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'start editing' }));
    await view.ready();
    expect(view.load).toHaveBeenCalledTimes(1);
    expect(received?.initialSend).toBe(true);
  });
  it('keeps the native picker mounted while loading and hands over its selected files', async () => {
    const view = setup();
    const picker = screen.getByLabelText('attach files', { selector: 'input' });
    const click = vi.spyOn(picker, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'attach files' }));
    expect(click).toHaveBeenCalledTimes(1);
    await view.ready();
    expect(picker).toBeInTheDocument();
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    fireEvent.change(picker, { target: { files: [file] } });
    expect(received?.initialFiles).toEqual([file]);
    expect(received?.initialSend).toBe(false);
  });
  it('keyboard attach opens picker synchronously; cancel completes handoff without files', async () => {
    const view = setup();
    const picker = screen.getByLabelText('attach files', { selector: 'input' });
    const click = vi.spyOn(picker, 'click');
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true });
    expect(click).toHaveBeenCalledTimes(1);
    await view.ready();
    fireEvent(picker, new Event('cancel'));
    expect(received?.initialFiles).toEqual([]);
  });
  it('defers replacement until IME composition ends', async () => {
    const view = setup();
    const input = editor();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'に' } });
    await view.ready();
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '日本' } });
    fireEvent.compositionEnd(input);
    expect(received?.initialPrompt).toBe('日本');
  });
  it('preserves pasted and dropped files and validates before handoff', async () => {
    const view = setup();
    const image = new File(['a'], 'image.png', { type: 'image/png' });
    const audio = new File(['b'], 'music.mp3', { type: 'audio/mpeg' });
    const bad = new File(['x'], 'bad.exe', {
      type: 'application/octet-stream',
    });
    fireEvent.paste(editor(), { clipboardData: { files: [image] } });
    fireEvent.dragEnter(window, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('drop to add to your video')).toBeInTheDocument();
    await view.ready();
    expect(screen.queryByTestId('interactive')).not.toBeInTheDocument();
    fireEvent.drop(window, { dataTransfer: { files: [audio, bad] } });
    expect(received?.initialFiles).toEqual([image, audio]);
    expect(received?.initialErrors).toEqual([
      'bad.exe can’t be used: that file type isn’t supported yet',
    ]);
  });
  it('typing after a failed import stays intact and retry does not carry a previous send', async () => {
    const view = setup();
    fireEvent.change(editor(), { target: { value: 'my retained input' } });
    fireEvent.keyDown(editor(), { key: 'Enter' });
    await view.fail();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'couldn’t load the editor. your input is still here.',
    );
    expect(editor()).toHaveValue('my retained input');
    view.load.mockResolvedValueOnce({ Page, Providers });
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'try again' })),
    );
    expect(view.load).toHaveBeenCalledTimes(2);
    expect(received).toMatchObject({
      initialPrompt: 'my retained input',
      initialSend: false,
    });
  });
  it.each(['aspect ratio: auto', 'any length', 'video settings'])(
    'replays the %s settings gesture, not send',
    async (name) => {
      const view = setup();
      fireEvent.click(screen.getByRole('button', { name }));
      await view.ready();
      expect(received).toMatchObject({
        initialControl: name,
        initialSend: false,
      });
    },
  );
  it('carries sign-in intent without submitting', async () => {
    const view = setup();
    fireEvent.click(screen.getByRole('button', { name: 'sign in' }));
    await view.ready();
    expect(received).toMatchObject({ initialSignIn: true, initialSend: false });
  });
  it('does not statically import the heavy graph or use Next dynamic preload', () => {
    const source = readFileSync(
      'apps/web/src/components/landing/landing-bootstrap.tsx',
      'utf8',
    );
    const imports =
      source
        .match(/^import .*? from ['"].*?['"];$/gm)
        ?.filter((line) => !line.startsWith('import type')) ?? [];
    expect(imports.join('\n')).not.toMatch(
      /motion|uploads|@kimo|zod|react-query|components\/ui|landing-page|interactive-providers|next\/dynamic/,
    );
    expect(source).toContain("import('./landing-page')");
    expect(source).toContain("import('@/app/interactive-providers')");
  });
});
