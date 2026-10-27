import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CommandPalette,
  CompareControl,
  ExportOptions,
  CaptionDownload,
  BeatToggle,
  CutsMenu,
  CutPreviewBanner,
  ShortcutsCoachmarks,
} from './index';
import { createCutStore } from '@/lib/studio-finish';
import { fixture, memoryStorage } from '@/lib/editing/test-fixtures';
describe('finish components', () => {
  it('runs actual callback adapters and only prefills recent prompts', () => {
    const action = vi.fn(),
      prompt = vi.fn();
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        commands={[{ id: 'split', label: 'split', run: action }]}
        clips={[{ id: 'c', name: 'beach' }]}
        recentPrompts={['make slower']}
        onSelectClip={vi.fn()}
        onPrompt={prompt}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'split' }));
    expect(action).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('search commands'), {
      target: { value: 'slower' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'prompt · make slower' }),
    );
    expect(prompt).toHaveBeenCalledWith('make slower');
  });
  it('does not enable unsupported compare or fabricated beat snapping', () => {
    render(
      <>
        <CompareControl
          cutLabel="cut 1"
          capability={{ available: false, reason: 'dual scene unavailable' }}
          value={50}
          onChange={vi.fn()}
          onEnable={vi.fn()}
        />
        <BeatToggle available={false} enabled onChange={vi.fn()} />
      </>,
    );
    expect(
      screen.getByRole('button', { name: 'compare with cut 1' }),
    ).toBeDisabled();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'snap to beats' }),
    ).toBeDisabled();
  });
  it('keeps export defaults and marks unsupported controls unavailable', () => {
    render(
      <ExportOptions
        value={{ resolution: '1080p', format: 'mp4', alsoPortrait: false }}
        onChange={vi.fn()}
        capabilities={{
          resolution720: false,
          webm: false,
          dualPortrait: false,
        }}
      />,
    );
    expect(screen.getByText('720p')).toBeDisabled();
    expect(screen.getByText('webm')).toBeDisabled();
    expect(screen.getByLabelText('also export 9:16 version')).toBeDisabled();
  });
  it('hides captions download without valid timed content', () => {
    const { rerender } = render(<CaptionDownload title="video" cues={[]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(
      <CaptionDownload
        title="video"
        cues={[{ start: 0, end: 1, text: 'real' }]}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'download captions (.srt)' }),
    ).toBeInTheDocument();
  });
  it('shows immutable local cuts with restore disabled absent authority', () => {
    const cut = createCutStore().capture({
      sessionId: 's',
      requestId: 'r',
      project: fixture(),
      assets: [],
      createdAt: 1,
    });
    const select = vi.fn();
    render(
      <>
        <CutsMenu
          cuts={[cut]}
          selectedId={null}
          onSelect={select}
          onExit={vi.fn()}
        />
        <CutPreviewBanner cut={cut} onExit={vi.fn()} />
      </>,
    );
    fireEvent.change(screen.getByLabelText('cuts on this device'), {
      target: { value: cut.id },
    });
    expect(select).toHaveBeenCalledWith(cut.id);
    expect(
      screen.getByRole('button', { name: 'restore this cut' }),
    ).toBeDisabled();
  });
  it('does not show onboarding after durable dismissal', () => {
    const storage = memoryStorage();
    storage.setItem('kimo-shortcuts-dismissed:v1', 'true');
    render(
      <ShortcutsCoachmarks
        storage={storage}
        anchors={{ agent: null, viewer: null, finish: null }}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('coachmark and SRT lifecycle', () => {
  it('shows exactly three steps, prepares mobile anchors, focuses next, dismisses on Escape once', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    anchor.focus();
    vi.spyOn(anchor, 'getClientRects').mockReturnValue({
      length: 1,
    } as DOMRectList);
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 50,
      top: 0,
      bottom: 40,
      width: 50,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const storage = memoryStorage(),
      prepare = vi.fn();
    const { unmount } = render(
      <ShortcutsCoachmarks
        storage={storage}
        anchors={{ agent: anchor, viewer: anchor, finish: anchor }}
        onPrepareAnchor={prepare}
      />,
    );
    expect(
      screen.getByText('talk to kimo here, even while it’s working'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'next' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(
      screen.getByText('double-click any text to rewrite it'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(screen.getByText('render when you’re happy')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'got it' }), {
      key: 'Escape',
    });
    expect(storage.getItem('kimo-shortcuts-dismissed:v1')).toBe('true');
    expect(anchor).toHaveFocus();
    expect(prepare.mock.calls.map(([step]) => step)).toEqual([
      'agent',
      'viewer',
      'finish',
    ]);
    unmount();
    anchor.remove();
  });
  it('downloads real SRT blob and revokes its object URL', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:captions'),
      revoke = vi.fn();
    const originalCreate = URL.createObjectURL,
      originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const { unmount } = render(
      <CaptionDownload
        title="movie"
        cues={[{ start: 0.5, end: 1.5, text: 'actual' }]}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'download captions (.srt)' }),
    );
    expect(create.mock.calls).toHaveLength(1);
    expect(click).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:captions');
    unmount();
    click.mockRestore();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.useRealTimers();
  });
});
