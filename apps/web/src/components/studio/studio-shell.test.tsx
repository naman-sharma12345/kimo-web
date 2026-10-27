import * as React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent, SessionSnapshot } from '@kimo/client';
import {
  project as sceneProject,
  source as sceneSource,
} from './timeline/test-fixtures';
import { StudioShell } from './studio-shell';
import { useStudio } from '@/stores/studio';
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  connect: vi.fn(),
  receive: undefined as ((event: ServerEvent) => void) | undefined,
  send: vi.fn(),
  close: vi.fn(),
  message: vi.fn(async () => {}),
  session: vi.fn(),
  approve: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/api', () => ({
  api: {
    connect: mocks.connect,
    message: mocks.message,
    session: mocks.session,
    approve: mocks.approve,
  },
}));
const snapshot: SessionSnapshot = {
  status: 'editing',
  project: {
    id: 'p',
    version: 0,
    fps: 30,
    width: 1920,
    height: 1080,
    duration: 45,
    tracks: [],
    clips: {},
    markers: [],
  },
  assets: [],
};
beforeEach(() => {
  // These integration tests exercise state/lifecycle only, never canvas pixels or GPU acceptance.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(snapshot);
  mocks.approve.mockResolvedValue({ renderId: 'render-job' });
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', {
    value: 1920,
    writable: true,
    configurable: true,
  });
  mocks.connect.mockImplementation((_url, receive) => {
    mocks.receive = receive;
    return {
      readyState: WebSocket.OPEN,
      send: mocks.send,
      close: mocks.close,
      onopen: null,
    };
  });
});
describe('Phase 5 studio shell integration', () => {
  it('renders all quiet panel boundaries and the original request immediately', () => {
    render(
      <StudioShell
        sessionId="s"
        snapshot={snapshot}
        originalPrompt="my original request"
        subscribe={false}
      />,
    );
    for (const id of [
      'studio-topbar',
      'studio-agent',
      'studio-viewer',
      'studio-inspector',
      'studio-timeline',
      'studio-statusbar',
    ])
      expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getAllByText('my original request')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'finish' })).toBeDisabled();
    expect(screen.getByText('preview fps unavailable')).toBeInTheDocument();
    expect(screen.getByText('proxies unknown')).toBeInTheDocument();
    expect(
      screen.getByText('kimo is laying out the first cut…'),
    ).toBeInTheDocument();
    expect(screen.queryByText('preview 60 fps')).not.toBeInTheDocument();
    expect(
      screen.getByRole('grid', { name: 'timeline editor' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('slider', { name: 'timeline scrubber' }),
    ).toHaveLength(1);
    expect(screen.queryByLabelText('loading timeline')).not.toBeInTheDocument();
  });
  it('restores only supplied recorded IDs after reset and deduplicates live replay', () => {
    const actionIds = ['server-recorded-a', 'server-recorded-b'];
    const restored: SessionSnapshot = {
      ...snapshot,
      status: 'awaiting_review',
      project: { ...snapshot.project, version: 99 },
      actionIds,
      wsUrl: 'ws://localhost/session',
    };
    const { rerender } = render(
      <StudioShell sessionId="restored" snapshot={restored} />,
    );
    expect(useStudio.getState().actionIds).toEqual(actionIds);
    expect(
      screen.getByRole('button', { name: 'waiting for you' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'finish' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'finish' })).toHaveAttribute(
      'data-review',
      'true',
    );
    act(() =>
      mocks.receive?.({
        t: 'agent.action.start',
        id: 'server-recorded-a',
        tool: 'cut',
        title: '',
        args: {},
      }),
    );
    expect(useStudio.getState().actionIds).toEqual(actionIds);
    expect(
      screen.getByRole('button', { name: 'waiting for you' }),
    ).toBeInTheDocument();
    expect(useStudio.getState().activeAction).toBeNull();
    expect(screen.queryByText('· 2 actions')).not.toBeInTheDocument();
    act(() =>
      mocks.receive?.({
        t: 'agent.action.start',
        id: 'new-live-action',
        tool: 'cut',
        title: '',
        args: {},
      }),
    );
    expect(useStudio.getState().actionIds).toEqual([
      ...actionIds,
      'new-live-action',
    ]);
    expect(screen.getByText('· 3 actions')).toBeInTheDocument();
    // A fresh REST restore keeps only authoritative IDs, not previous local state.
    rerender(<StudioShell sessionId="restored" snapshot={{ ...restored }} />);
    expect(useStudio.getState().actionIds).toEqual(actionIds);
    expect(
      screen.getByRole('button', { name: 'waiting for you' }),
    ).toBeInTheDocument();
  });
  it.each([undefined, []])(
    'keeps historical snapshots safe without supplied history (%j)',
    (actionIds) => {
      act(() =>
        useStudio.setState({ actionIds: ['stale-other-session-action'] }),
      );
      render(
        <StudioShell
          sessionId="legacy"
          snapshot={{
            ...snapshot,
            status: 'awaiting_review',
            project: { ...snapshot.project, version: 99 },
            ...(actionIds ? { actionIds } : {}),
          }}
          subscribe={false}
        />,
      );
      expect(useStudio.getState().actionIds).toEqual([]);
      expect(screen.queryByText(/· \d+ actions/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'finish' })).toBeDisabled();
    },
  );
  it('collapses panels, persists, keyboard-resizes, clamps and resets', () => {
    render(
      <StudioShell
        sessionId="s"
        snapshot={snapshot}
        userKey="test-user"
        subscribe={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'collapse agent' }));
    expect(
      screen.getByRole('button', { name: 'expand agent' }),
    ).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem('kimo-studio:v1:test-user') ?? '{}')
        .agentCollapsed,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'expand agent' }));
    const resizer = screen.getByRole('slider', { name: 'resize agent' });
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(useStudio.getState().sizes.agent).toBe(368);
    fireEvent.doubleClick(resizer);
    expect(useStudio.getState().sizes.agent).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'toggle inspector' }));
    expect(screen.queryByTestId('studio-inspector')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'collapse timeline' }));
    expect(screen.getByTestId('studio-timeline')).toHaveAttribute(
      'data-collapsed',
      'true',
    );
    expect(screen.queryByLabelText('timeline ruler')).not.toBeInTheDocument();
  });
  it('inline title saves locally, Escape cancels and leave confirmation protects the edit', () => {
    render(<StudioShell sessionId="s" snapshot={snapshot} subscribe={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'untitled video' }));
    fireEvent.change(screen.getByLabelText('project title'), {
      target: { value: 'manali trip reel' },
    });
    fireEvent.keyDown(screen.getByLabelText('project title'), { key: 'Enter' });
    expect(
      screen.getByRole('heading', { name: 'manali trip reel' }),
    ).toBeInTheDocument();
    expect(localStorage.getItem('kimo-studio-title:v1:s')).toBe(
      'manali trip reel',
    );
    fireEvent.click(screen.getByRole('button', { name: 'manali trip reel' }));
    fireEvent.change(screen.getByLabelText('project title'), {
      target: { value: 'discard me' },
    });
    fireEvent.keyDown(screen.getByLabelText('project title'), {
      key: 'Escape',
    });
    expect(
      screen.getByRole('heading', { name: 'manali trip reel' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'kimo home' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('leave the studio?');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'your edit keeps its place for 24 hours.',
    );
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^leave$/ }));
    expect(mocks.push).toHaveBeenCalledWith('/');
  });
  it('uses one typed subscription for pill, action count, pause/resume and review pulse', async () => {
    render(
      <StudioShell
        sessionId="s"
        snapshot={{ ...snapshot, wsUrl: 'ws://localhost/session' }}
      />,
    );
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    const ws = mocks.connect.mock.results[0]?.value as {
      onopen: (() => void) | null;
    };
    act(() => {
      ws.onopen?.();
      mocks.receive?.({ t: 'agent.status', state: 'thinking', label: '' });
    });
    expect(
      screen.getByRole('button', { name: 'kimo is thinking' }),
    ).toBeInTheDocument();
    act(() =>
      mocks.receive?.({
        t: 'agent.action.start',
        id: 'a',
        tool: 'cut',
        title: '',
        args: {},
      }),
    );
    expect(screen.getByText('· 1 actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'finish' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'pause kimo' }));
    expect(mocks.send).toHaveBeenLastCalledWith(JSON.stringify({ t: 'pause' }));
    expect(screen.getByRole('button', { name: 'paused' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'let kimo continue' }));
    expect(mocks.send).toHaveBeenLastCalledWith(
      JSON.stringify({ t: 'resume' }),
    );
    act(() =>
      mocks.receive?.({
        t: 'agent.message',
        id: 'm',
        role: 'agent',
        text: '',
        kind: 'ask_review',
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'finish' })).toHaveAttribute(
        'data-review',
        'true',
      ),
    );
  });
  it('dispatches transport intent, guards typing, and exposes the registry in help', () => {
    render(<StudioShell sessionId="s" snapshot={snapshot} subscribe={false} />);
    fireEvent.keyDown(window, { key: ' ' });
    expect(useStudio.getState().playing).toBe(true);
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
    expect(useStudio.getState().playhead).toBe(1);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'message kimo' }), {
      key: ' ',
    });
    expect(useStudio.getState().playing).toBe(true);
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    expect(screen.getByRole('dialog')).toHaveTextContent('keyboard shortcuts');
    expect(screen.getByText('ripple-delete selection')).toBeInTheDocument();
  });
  it('toggles shell fullscreen with F without exiting an unrelated fullscreen element', () => {
    render(<StudioShell sessionId="s" snapshot={snapshot} subscribe={false} />);
    const viewer = screen.getByTestId('studio-viewer');
    const enter = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(viewer, 'requestFullscreen', {
      value: enter,
      configurable: true,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      value: exit,
      configurable: true,
    });
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
    });
    try {
      fireEvent.keyDown(window, { key: 'f' });
      expect(enter).toHaveBeenCalledTimes(1);
      Object.defineProperty(document, 'fullscreenElement', {
        value: viewer,
        configurable: true,
      });
      fireEvent.keyDown(window, { key: 'f' });
      expect(exit).toHaveBeenCalledTimes(1);
      expect(enter).toHaveBeenCalledTimes(1);
      Object.defineProperty(document, 'fullscreenElement', {
        value: document.body,
        configurable: true,
      });
      fireEvent.keyDown(window, { key: 'f' });
      expect(exit).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(document, 'fullscreenElement');
      Reflect.deleteProperty(document, 'exitFullscreen');
    }
  });
  it('opens the tablet inspector on a new selection without forcing it open on desktop', () => {
    window.innerWidth = 1100;
    render(<StudioShell sessionId="s" snapshot={snapshot} subscribe={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'toggle inspector' }));
    expect(screen.queryByTestId('studio-inspector')).not.toBeInTheDocument();
    act(() => useStudio.setState({ selection: ['clip-1'] }));
    expect(screen.getByTestId('studio-inspector')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'toggle inspector' }));
    act(() => useStudio.setState({ selection: [] }));
    expect(screen.queryByTestId('studio-inspector')).not.toBeInTheDocument();
    window.innerWidth = 1920;
    fireEvent(window, new Event('resize'));
    act(() => useStudio.setState({ selection: ['clip-2'] }));
    expect(screen.queryByTestId('studio-inspector')).not.toBeInTheDocument();
  });
  it('accepts composable later-phase slots without creating fake content', () => {
    render(
      <StudioShell
        sessionId="s"
        snapshot={snapshot}
        subscribe={false}
        slots={{
          viewer: <div>provided viewer</div>,
          inspector: <div>provided inspector</div>,
          timeline: <div>provided timeline</div>,
          agentChat: <div>provided chat</div>,
        }}
      />,
    );
    for (const name of ['viewer', 'inspector', 'timeline', 'chat'])
      expect(screen.getByText(`provided ${name}`)).toBeInTheDocument();
    expect(
      screen.queryByText('live preview connects in Phase 6'),
    ).not.toBeInTheDocument();
  });
});

describe('Phase 8 Shell transport integration', () => {
  function enter(text: string) {
    const editor = screen.getByRole('textbox', { name: 'message kimo' });
    editor.textContent = text;
    fireEvent.input(editor);
    return editor;
  }
  it('routes Mod+Enter once through the existing HTTP client', async () => {
    render(
      <StudioShell sessionId="send" snapshot={snapshot} subscribe={false} />,
    );
    const editor = enter('make the intro shorter');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(mocks.message).toHaveBeenCalledTimes(1));
    expect(mocks.message).toHaveBeenCalledWith(
      'send',
      'make the intro shorter',
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('retains composer draft across collapse and sends one legacy interrupt, not HTTP too', async () => {
    render(
      <StudioShell
        sessionId="interrupt"
        snapshot={{ ...snapshot, wsUrl: 'ws://example.test/s' }}
      />,
    );
    act(() =>
      mocks.receive?.({
        t: 'agent.action.start',
        id: 'a',
        tool: 'trim_clip',
        title: 'trimming beach',
        args: {},
        target: { clipId: 'beach', time: 2 },
      }),
    );
    enter('keep this part');
    fireEvent.click(screen.getByRole('button', { name: 'collapse agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'expand agent' }));
    expect(
      screen.getByRole('textbox', { name: 'message kimo' }),
    ).toHaveTextContent('keep this part');
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mocks.send.mock.calls[0]?.[0] as string)).toEqual({
      t: 'interrupt',
      text: 'keep this part',
    });
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.studio-agent-status')).toHaveAttribute(
      'data-action-id',
      'a',
    );
    expect(
      document.querySelector('[aria-label="inspector"][data-action-id]'),
    ).toHaveAttribute('data-clip-id', 'beach');
  });
  it('keeps the controller usable after React development effect replay', async () => {
    render(
      <React.StrictMode>
        <StudioShell sessionId="strict" snapshot={snapshot} subscribe={false} />
      </React.StrictMode>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    enter('strict note');
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() =>
      expect(mocks.message).toHaveBeenCalledWith('strict', 'strict note'),
    );
  });
});

it('projects one actual start target into all five surfaces without fabricating property edits', () => {
  const targetSnapshot: SessionSnapshot = {
    ...snapshot,
    project: sceneProject(),
    assets: [sceneSource],
    wsUrl: 'ws://example.test/target',
  };
  render(
    <StudioShell
      sessionId="target"
      snapshot={targetSnapshot}
      slots={{ viewer: <span>custom preview</span> }}
    />,
  );
  act(() =>
    mocks.receive?.({
      t: 'agent.action.start',
      id: 'target-action',
      tool: 'trim_clip',
      title: 'trimming beach_02',
      args: {},
      target: { clipId: 'a', time: 4, region: { x: 10, y: 10, w: 30, h: 30 } },
    }),
  );
  for (const selector of [
    '.studio-agent-status',
    '[data-testid="studio-viewer"]',
    '[aria-label="inspector"][data-action-id]',
    '[aria-label="agent panel"] section[data-action-id]',
  ]) {
    expect(document.querySelector(selector)).toHaveAttribute(
      'data-action-id',
      'target-action',
    );
    expect(document.querySelector(selector)).toHaveAttribute(
      'data-clip-id',
      'a',
    );
  }
  expect(document.querySelector('[data-clip-proxy="a"]')).toHaveAttribute(
    'data-active',
    'true',
  );
  expect(
    document.querySelector(
      '[aria-label="agent panel"] [role="img"][data-action-id]',
    ),
  ).toHaveAttribute('data-action-id', 'target-action');
  expect(mocks.connect).toHaveBeenCalledTimes(1);
});

describe('Phase 9 review approval integration', () => {
  const reviewSnapshot: SessionSnapshot = {
    ...snapshot,
    status: 'awaiting_review',
    actionIds: ['recorded'],
  };
  it('uses the actual saved project title and confirms one approval before routing', async () => {
    localStorage.setItem('kimo-studio-title:v1:review', 'my actual title');
    render(
      <StudioShell
        sessionId="review"
        snapshot={reviewSnapshot}
        subscribe={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'finish' }));
    expect(await screen.findByText('ready to render?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'render 1080p' }));
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledTimes(1));
    expect(mocks.approve.mock.calls[0]?.slice(0, 2)).toEqual([
      'review',
      {
        title: 'my actual title',
        burnInCaptions: false,
        expectedProjectVersion: 0,
        preset: '1080p',
      },
    ]);
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith('/render/review'),
    );
  });
  it('waits for the actual pause status packet before opening review while acting', async () => {
    render(
      <StudioShell
        sessionId="working"
        snapshot={{ ...reviewSnapshot, wsUrl: 'ws://example.test/working' }}
      />,
    );
    act(() =>
      mocks.receive?.({
        t: 'agent.action.start',
        id: 'working-step',
        tool: 'trim_clip',
        title: 'trimming the intro',
        args: {},
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'finish' }));
    expect(await screen.findByText('render now?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'render now' }));
    expect(mocks.send).toHaveBeenCalledWith(JSON.stringify({ t: 'pause' }));
    expect(screen.queryByText('ready to render?')).not.toBeInTheDocument();
    expect(mocks.approve).not.toHaveBeenCalled();
    act(() =>
      mocks.receive?.({ t: 'agent.status', state: 'idle', label: 'paused' }),
    );
    expect(await screen.findByText('ready to render?')).toBeInTheDocument();
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it('blocks a second approval while a lost response remains unresolved', async () => {
    mocks.approve.mockRejectedValue(new Error('connection lost'));
    render(
      <StudioShell
        sessionId="unknown-render"
        snapshot={reviewSnapshot}
        subscribe={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'finish' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'render 1080p' }),
    );
    expect(
      await screen.findByRole('button', { name: 'check render status' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'check render status' }),
    );
    await waitFor(() =>
      expect(mocks.session.mock.calls.length).toBeGreaterThanOrEqual(3),
    );
    expect(mocks.approve).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
