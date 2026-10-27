import * as React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { Asset } from '@kimo/client';
import type { AgentAction, AgentState, ChatItem } from '@/lib/agent/types';
import { createAgentState } from '@/lib/agent/reducer';
import { ChatStream, type AgentPresentationCallbacks } from './chat-stream';
import { ActionsTable } from './actions-table';
import { ActionGroup } from './action-group';
import { RichText, safeUrl } from './rich-text';
import { SamResult } from './sam-result';
import { WebImages, ResourceImage } from './web-images';
const callbacks = (): AgentPresentationCallbacks => ({
  onShow: vi.fn(),
  onRevert: vi.fn(),
  onViewMask: vi.fn(),
  onPlayFromStart: vi.fn(),
  onFocusComposer: vi.fn(),
  onRender: vi.fn(),
  onSend: vi.fn(),
  onFeedback: vi.fn(),
  onRetry: vi.fn(),
});
const action = (
  id: string,
  tool = 'trim_clip',
  status: AgentAction['status'] = 'done',
): AgentAction => ({
  id,
  groupId: 'group:first',
  tool,
  title: `step ${id}`,
  args: { clip: 'beach', nested: { start: 2 } },
  target: { clipId: 'clip-1' },
  status,
  receivedAtMs: 0,
  durationMs: 800,
});
const group: Extract<ChatItem, { kind: 'action-group' }> = {
  kind: 'action-group',
  id: 'group:first',
  actionIds: ['1', '2', '3', '4'],
  responseToNote: true,
  stoppedAdjusting: false,
};
const asset: Asset = {
  id: 'web1',
  name: 'actual image',
  kind: 'image',
  source: 'web',
  url: 'https://example.com/a.png',
  attribution: {
    site: 'example.com',
    pageUrl: 'https://example.com/photo',
    license: 'CC BY',
  },
};
function model(
  items: readonly ChatItem[] = [],
  actions: readonly AgentAction[] = [],
): AgentState {
  return {
    ...createAgentState({ sessionId: 's' }),
    items,
    actions: Object.fromEntries(actions.map((item) => [item.id, item])),
    actionOrder: actions.map((item) => item.id),
    assets: { web1: asset },
  };
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('read-only agent presentation', () => {
  it('renders all nine row types and routes exact callbacks', () => {
    const cb = callbacks();
    const items: ChatItem[] = [
      {
        kind: 'user',
        id: 'u',
        text: 'make a cut',
        attachments: [],
        delivery: 'accepted',
        receivedAtMs: 0,
        interrupt: 'pending',
      },
      { kind: 'say', id: 's', text: 'hello **there**' },
      group,
      { kind: 'system', id: 'sys', text: 'reconnected' },
      { kind: 'review', id: 'r', text: 'ready for review' },
      {
        kind: 'choice',
        id: 'c',
        text: 'choose',
        choices: ['first', 'second', 'third', 'fourth', 'hidden fifth'],
      },
      { kind: 'web-images', id: 'w', assetIds: ['web1'] },
      { kind: 'sam', id: 'mask', clipId: 'clip-1', maskAssetId: 'missing' },
      { kind: 'error', id: 'e', message: 'step failed', actionId: 'bad' },
    ];
    render(
      <ChatStream
        {...cb}
        model={model(items, [
          action('1'),
          action('2'),
          action('3'),
          action('4'),
        ])}
        orangeOwner="review"
        clipNames={{ 'clip-1': 'beach_02' }}
      />,
    );
    expect(screen.getByText('make a cut')).toBeVisible();
    expect(screen.getByText('there').tagName).toBe('STRONG');
    expect(screen.getByText('reconnected')).toBeVisible();
    expect(
      screen.getByText('kimo will read this after the current step'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'hidden fifth' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'first' }));
    expect(cb.onSend).toHaveBeenCalledWith('first');
    fireEvent.click(screen.getByRole('button', { name: 'play from start' }));
    expect(cb.onPlayFromStart).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'ask for changes' }));
    expect(cb.onFocusComposer).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole('button', { name: 'looks good, render it' }),
    );
    expect(cb.onRender).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'view mask' }));
    expect(cb.onViewMask).toHaveBeenCalledWith('clip-1', 'missing');
    fireEvent.click(screen.getByRole('button', { name: 'retry step' }));
    expect(cb.onRetry).toHaveBeenCalledWith('bad');
    expect(screen.getByText('mask preview unavailable')).toBeVisible();
  });
  it('collapses last three, expands all and reverts selected actual ID', () => {
    const cb = callbacks();
    render(
      <ActionGroup
        item={group}
        actions={group.actionIds.map((id) => action(id))}
        orangeOwner="none"
        {...cb}
      />,
    );
    expect(
      screen.queryByText('step 1', { selector: 'li span' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'show' })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getAllByRole('button', { name: 'show' })).toHaveLength(4);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'revert this step' }));
    expect(cb.onRevert).toHaveBeenCalledWith('2');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'show' })[0] as HTMLElement,
    );
    expect(cb.onShow).toHaveBeenCalledWith('1');
  });
  it('filters audit with all four filters, clip-name search and pretty JSON details', () => {
    render(
      <ActionsTable
        model={model(
          [],
          [
            action('edit'),
            action('sam', 'sam_mask'),
            action('fail', 'web_image_search', 'failed'),
          ],
        )}
        orangeOwner="none"
        clipNames={{ 'clip-1': 'beach_02' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ai models' }));
    expect(screen.getByText('sam_mask')).toBeVisible();
    expect(screen.queryByText('trim_clip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'failed' }));
    expect(screen.getByText('web_image_search')).toBeVisible();
    expect(screen.queryByText('sam_mask')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'edits' }));
    expect(screen.getByText('trim_clip')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'beach_02' },
    });
    expect(screen.getByText('trim_clip')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByLabelText('arguments for trim_clip').textContent).toBe(
      JSON.stringify(action('edit').args, null, 2),
    );
    fireEvent.click(screen.getByRole('button', { name: /^all$/ }));
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(2);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'not-found' },
    });
    expect(screen.getByText('no matching actions')).toBeVisible();
  });
  it('treats HTML as text and rejects unsafe links/resources', () => {
    render(
      <RichText
        text={
          '<img src=x onerror=alert(1)> **bold** `code` [bad](javascript:alert) [safe](https://example.com)'
        }
      />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'bad' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'safe' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(safeUrl('//evil.test', true)).toBeUndefined();
    expect(safeUrl('data:image/svg+xml,evil', true)).toBeUndefined();
    expect(safeUrl('/real.png', true)).toBe('/real.png');
  });
  it('streams every 40ms and disposes timers on inactivity and unmount', () => {
    vi.useFakeTimers();
    const view = render(<RichText text="one two three" streaming />);
    expect(view.container).toHaveTextContent('');
    act(() => vi.advanceTimersByTime(40));
    expect(view.container.textContent).toBe('one ');
    act(() => vi.advanceTimersByTime(40));
    expect(view.container.textContent).toBe('one two ');
    view.rerender(<RichText text="one two three" streaming active={false} />);
    expect(vi.getTimerCount()).toBe(0);
    view.rerender(<RichText text="one two three" streaming />);
    act(() => vi.advanceTimersByTime(160));
    expect(view.container.textContent).toBe('one two three');
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('shows received text without timers in reduced motion', () => {
    vi.useFakeTimers();
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const view = render(<RichText text="one two" streaming />);
    expect(view.container.textContent).toBe('one two');
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
    window.matchMedia = original;
  });
  it('pins at 80px, does not steal position at 81px and offers new activity', () => {
    const cb = callbacks();
    const initial = model([{ kind: 'say', id: '1', text: 'first' }]);
    const view = render(
      <ChatStream {...cb} model={initial} orangeOwner="none" />,
    );
    const viewport = screen.getByLabelText('conversation');
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 },
    });
    viewport.scrollTop = 820;
    fireEvent.scroll(viewport);
    view.rerender(
      <ChatStream
        {...cb}
        model={{
          ...initial,
          items: [...initial.items, { kind: 'system', id: '2', text: 'next' }],
        }}
        orangeOwner="none"
      />,
    );
    expect(viewport.scrollTop).toBe(1000);
    viewport.scrollTop = 819;
    fireEvent.scroll(viewport);
    view.rerender(
      <ChatStream
        {...cb}
        model={{
          ...initial,
          items: [...initial.items, { kind: 'system', id: '3', text: 'new' }],
        }}
        orangeOwner="none"
      />,
    );
    expect(viewport.scrollTop).toBe(819);
    fireEvent.click(screen.getByRole('button', { name: 'new activity ↓' }));
    expect(viewport.scrollTop).toBe(1000);
    expect(
      screen.queryByRole('button', { name: 'new activity ↓' }),
    ).not.toBeInTheDocument();
  });
  it('uses actual web attribution and licence with exact asset feedback, restores focus', () => {
    const cb = callbacks();
    render(<WebImages assets={[asset]} onFeedback={cb.onFeedback} />);
    const trigger = screen.getByRole('button', {
      name: 'preview actual image from example.com',
    });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link')).toHaveAttribute(
      'href',
      'https://example.com/photo',
    );
    expect(within(dialog).getByText('licence: CC BY')).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'not this one' }),
    );
    expect(cb.onFeedback).toHaveBeenCalledWith('web1', 'reject');
    expect(trigger).toHaveFocus();
  });
  it('does not infer a SAM subject or substitute an unrelated thumbnail', () => {
    render(
      <SamResult
        item={{ kind: 'sam', id: 'sam', clipId: 'clip', maskAssetId: 'web1' }}
        asset={asset}
        onViewMask={vi.fn()}
      />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/selection in clip with sam 3.1/)).toBeVisible();
    expect(screen.queryByText(/person/)).not.toBeInTheDocument();
  });
  it('arbitrates one orange review among multiple review rows', () => {
    const view = render(
      <ChatStream
        {...callbacks()}
        model={model([
          { kind: 'review', id: 'old', text: 'old review' },
          { kind: 'review', id: 'new', text: 'new review' },
        ])}
        orangeOwner="review"
      />,
    );
    const buttons = screen.getAllByRole('button', {
      name: 'looks good, render it',
    });
    expect(buttons[0]?.className).toBe('');
    expect(buttons[1]?.className).not.toBe('');
    view.rerender(
      <ChatStream
        {...callbacks()}
        model={model([{ kind: 'review', id: 'old', text: 'old review' }])}
        orangeOwner="running"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'looks good, render it' }).className,
    ).toBe('');
  });
});

describe('presentation resource and lifecycle boundaries', () => {
  it('falls back after an actual image loading error', () => {
    render(
      <ResourceImage
        src="https://example.com/missing.png"
        alt="missing resource"
      />,
    );
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('preview unavailable')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('keeps attribution and licence unknown when absent', () => {
    const cb = callbacks();
    render(
      <WebImages
        assets={[{ ...asset, attribution: undefined }]}
        onFeedback={cb.onFeedback}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /preview actual image/ }),
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
    expect(within(dialog).getByText('licence: unknown')).toBeVisible();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('disposes shared elapsed ticks when chat becomes inactive', () => {
    vi.useFakeTimers();
    const running = action('live', 'trim_clip', 'running');
    const state = {
      ...model([{ ...group, actionIds: ['live'] }], [running]),
      foregroundActionId: 'live',
    };
    const view = render(
      <ChatStream {...callbacks()} model={state} orangeOwner="running" />,
    );
    expect(vi.getTimerCount()).toBe(1);
    view.rerender(
      <ChatStream
        {...callbacks()}
        model={state}
        orangeOwner="running"
        active={false}
      />,
    );
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('shows a genuine image mask and explicit subject only from event metadata', () => {
    render(
      <SamResult
        item={{
          kind: 'sam',
          id: 'sam',
          clipId: 'clip',
          maskAssetId: 'mask',
          subjectLabel: 'person',
        }}
        clipName="beach_02"
        asset={{
          ...asset,
          id: 'mask',
          mask: {
            encoding: 'luma_image',
            width: 96,
            height: 54,
            coordinateSpace: 'source_uv',
            channel: 'luma',
          },
        }}
        onViewMask={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('img', { name: 'SAM mask resource' }),
    ).toHaveAttribute('src', asset.url);
    expect(
      screen.getByText('selected the person in beach_02 with sam 3.1'),
    ).toBeVisible();
  });
  it('does not provide retry for an uncorrelated error', () => {
    render(
      <ChatStream
        {...callbacks()}
        model={model([{ kind: 'error', id: 'error', message: 'disconnected' }])}
        orangeOwner="none"
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'retry step' }),
    ).not.toBeInTheDocument();
  });
});
