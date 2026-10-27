import * as React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KimoProject, SessionSnapshot, ServerEvent } from '@kimo/client';
import { useStudio } from '@/stores/studio';
import { useProject } from '@/stores/project';
import { useEditing } from '@/stores/editing';
import { withBuiltinAssets } from './builtin-assets';
import {
  StudioCompositor,
  type StudioCompositorHandle,
} from './compositor-bridge';
import { StudioShell } from './studio-shell';
const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  created: vi.fn(),
  previewProject: null as KimoProject | null,
  init: vi.fn(async (): Promise<void> => undefined),
  dispose: vi.fn(),
  event: vi.fn(),
  assets: vi.fn(),
  updateProject: vi.fn(),
  transport: vi.fn(),
  resize: vi.fn(),
  session: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  playback: undefined as
    ((time: number, playing: boolean, fps: number | null) => void) | undefined,
  getFrame: vi.fn(async () => ({
    blob: new Blob(['readback'], { type: 'image/png' }),
    time: 1,
    projectVersion: 1,
    width: 640,
    height: 360,
    approximations: [],
  })),
  audioLevel: vi.fn(() => ({
    available: true,
    state: 'measuring' as const,
    peak: 0.5,
    rms: 0.25,
    peakDb: -6.02,
    rmsDb: -12.04,
  })),
  socketReceive: undefined as ((event: ServerEvent) => void) | undefined,
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/lib/editing/indexeddb', async () => {
  const { testPersistence } =
    await import('@/lib/editing/persistence-test-helpers');
  return {
    createIndexedDBEditPersistence: () => testPersistence().persistence,
  };
});
vi.mock('@/lib/api', () => ({
  api: {
    connect: (...args: unknown[]) => mocks.connect(...args),
    session: (...args: unknown[]) => mocks.session(...args),
  },
}));
vi.mock('@kimo/compositor', () => ({
  videoCache: new Map(),
  retainCompositorMediaOwnership: () => () => undefined,
  PixiRenderer: class {
    readonly testRenderer = true;
  },
  measureTextOverlay: vi.fn(async () => undefined),
  CompositorController: class {
    constructor(options: {
      project: KimoProject;
      assets: readonly import('@kimo/client').Asset[];
      onPlayback?: (time: number, playing: boolean, fps: number | null) => void;
    }) {
      mocks.created(options.project, options.assets);
      mocks.previewProject = options.project;
      mocks.playback = options.onPlayback;
    }
    init = mocks.init;
    dispose = mocks.dispose;
    event = (event: ServerEvent) => {
      if (event.t !== 'hello') mocks.event(event);
    };
    setAssets = mocks.assets;
    updateProject = (next: KimoProject) => {
      mocks.previewProject = next;
      mocks.updateProject(next);
    };
    setTransport = mocks.transport;
    resize = mocks.resize;
    getResource = () => undefined;
    getFrame = mocks.getFrame;
    getFilmstrip = vi.fn();
    getWaveform = vi.fn();
    getAudioLevel = mocks.audioLevel;
  },
}));
const project: KimoProject = {
  id: 'p',
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 10,
  tracks: [],
  clips: {
    text: {
      id: 'text',
      kind: 'text',
      trackId: 't',
      start: 0,
      duration: 10,
      in: 0,
      speed: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      effects: [],
      keyframes: [],
      text: { content: 'hello', style: 'title' },
    },
  },
  markers: [],
};
const snapshot: SessionSnapshot = {
  status: 'editing',
  project,
  assets: [],
  wsUrl: 'ws://one-socket',
};
beforeEach(() => {
  // These integration tests exercise state/lifecycle only, never canvas pixels or GPU acceptance.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  );
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(snapshot);
  useStudio.getState().resetSession('s', 10, true, false);
  useProject.getState().replace(project);
  Object.defineProperty(window, 'devicePixelRatio', {
    value: 1,
    configurable: true,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.connect.mockImplementation((_url, receive) => {
    mocks.socketReceive = receive;
    queueMicrotask(() => receive({ t: 'hello', version: 1 }));
    return {
      readyState: WebSocket.OPEN,
      close: mocks.close,
      send: vi.fn(),
      onopen: null,
    };
  });
});
describe('Studio compositor adapter lifecycle', () => {
  it('mounts once, observes intent but ignores playback publications, and disposes subscriptions', async () => {
    const bridgeRef = React.createRef<StudioCompositorHandle>();
    const result = render(
      <StudioCompositor project={project} assets={[]} bridgeRef={bridgeRef} />,
    );
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    const count = mocks.transport.mock.calls.length;
    act(() => useStudio.getState().publishPlayback(2, true, 50));
    expect(mocks.transport).toHaveBeenCalledTimes(count + 1);
    act(() => useStudio.getState().publishPlayback(3, true, 50));
    expect(mocks.transport).toHaveBeenCalledTimes(count + 1);
    act(() => useStudio.getState().seek(4));
    expect(mocks.transport).toHaveBeenLastCalledWith(expect.any(Object), 4);
    const projectUpdates = mocks.updateProject.mock.calls.length;
    act(() => useProject.getState().replace({ ...project, version: 2 }));
    expect(mocks.updateProject).toHaveBeenCalledTimes(projectUpdates + 1);
    result.unmount();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(bridgeRef.current).toBeNull();
    act(() => useProject.getState().replace({ ...project, version: 3 }));
    expect(mocks.updateProject).toHaveBeenCalledTimes(projectUpdates + 1);
  });
  it('shares zoom/guides state and fullscreen toggles without remounting the canvas/controller', async () => {
    const bridgeRef = React.createRef<StudioCompositorHandle>();
    render(
      <StudioCompositor project={project} assets={[]} bridgeRef={bridgeRef} />,
    );
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    const canvas = screen.getByTestId('compositor-canvas');
    const previous = document.createElement('button');
    document.body.appendChild(previous);
    previous.focus();
    act(() =>
      useStudio.setState({ viewerZoom: '50%', guides: true, fullscreen: true }),
    );
    expect(screen.getByTestId('compositor')).toHaveAttribute(
      'data-zoom',
      '50%',
    );
    expect(screen.getByTestId('compositor-guides')).toBeInTheDocument();
    expect(screen.getByTestId('compositor-canvas')).toBe(canvas);
    expect(mocks.created).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: 'close preview' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(
      screen.getByLabelText('fullscreen playhead'),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useStudio.getState().fullscreen).toBe(false);
    expect(document.activeElement).toBe(previous);
    previous.remove();
  });
  it('uses one Shell socket and forwards action/SAM once, assets via one registry update, no duplicate project ops', async () => {
    render(<StudioShell sessionId="s" snapshot={snapshot} />);
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    const event: ServerEvent = {
      t: 'agent.action.start',
      id: 'a',
      tool: 'sam',
      title: 'isolate',
      args: {},
      target: { clipId: 'text' },
    };
    act(() => mocks.socketReceive?.(event));
    expect(mocks.event).toHaveBeenCalledTimes(1);
    expect(mocks.event).toHaveBeenLastCalledWith(event);
    act(() =>
      mocks.socketReceive?.({
        t: 'sam.mask',
        actionId: 'a',
        clipId: 'text',
        maskAssetId: 'mask',
        previewPolygon: [],
      }),
    );
    expect(mocks.event).toHaveBeenCalledTimes(2);
    const asset = {
      id: 'image',
      kind: 'image' as const,
      name: 'new web image',
      source: 'web' as const,
      url: '/image.png',
    };
    const before = mocks.assets.mock.calls.length;
    act(() => mocks.socketReceive?.({ t: 'asset.added', asset }));
    expect(mocks.event).toHaveBeenCalledTimes(2);
    expect(mocks.assets).toHaveBeenCalledTimes(before + 1);
    expect(mocks.assets).toHaveBeenLastCalledWith(withBuiltinAssets([asset]));
  });
});

describe('Authoritative snapshot bridge', () => {
  it('serializes a contiguous op then refetches project and assets on a gap, without replaying ops twice', async () => {
    const asset = {
      id: 'new',
      name: 'authoritative image',
      kind: 'image' as const,
      source: 'user' as const,
      url: '/new',
    };
    mocks.session.mockResolvedValueOnce(snapshot).mockResolvedValue({
      ...snapshot,
      project: { ...project, version: 5 },
      assets: [asset],
    });
    const view = render(<StudioShell sessionId="s" snapshot={snapshot} />);
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    const editing = useEditing.getState().session;
    if (!editing) throw new Error('editing authority not attached');
    const receive = vi.spyOn(editing, 'receiveAuthoritative');
    act(() => mocks.socketReceive?.({ t: 'project.ops', version: 2, ops: [] }));
    await waitFor(() => expect(useProject.getState().project?.version).toBe(2));
    expect(receive).toHaveBeenCalledTimes(1);
    act(() => mocks.socketReceive?.({ t: 'project.ops', version: 5, ops: [] }));
    await waitFor(() => expect(useProject.getState().project?.version).toBe(5));
    expect(mocks.session).toHaveBeenCalledTimes(2);
    expect(receive).toHaveBeenCalledTimes(1);
    expect(mocks.assets).toHaveBeenLastCalledWith(withBuiltinAssets([asset]));
    act(() => mocks.socketReceive?.({ t: 'project.ops', version: 5, ops: [] }));
    expect(receive).toHaveBeenCalledTimes(1);
    view.unmount();
    receive.mockRestore();
  });
});

describe('StrictMode lazy lifecycle', () => {
  it('does not instantiate the abandoned async mount or leave an observer behind', async () => {
    const bridgeRef = React.createRef<StudioCompositorHandle>();
    const view = render(
      <React.StrictMode>
        <StudioCompositor project={project} assets={[]} bridgeRef={bridgeRef} />
      </React.StrictMode>,
    );
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    expect(mocks.created).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(bridgeRef.current).toBeNull();
  });
});

describe('Custom viewer slot bridge', () => {
  it('forwards registry/action events through the supplied ref without mounting a second controller or socket', async () => {
    const event = vi.fn(),
      assets = vi.fn();
    const bridgeRef = React.createRef<StudioCompositorHandle>();
    bridgeRef.current = { event, assets };
    render(
      <StudioShell
        sessionId="s"
        snapshot={snapshot}
        compositorRef={bridgeRef}
        slots={{ viewer: <div>custom live viewer</div> }}
      />,
    );
    await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(1));
    expect(mocks.created).not.toHaveBeenCalled();
    expect(screen.getByText('custom live viewer')).toBeInTheDocument();
    const action: ServerEvent = {
      t: 'agent.action.start',
      id: 'slot-action',
      tool: 'trim',
      title: 'trim',
      args: {},
      target: { clipId: 'text' },
    };
    act(() => mocks.socketReceive?.(action));
    expect(
      event.mock.calls.filter(([packet]) => packet.t === 'agent.action.start'),
    ).toHaveLength(1);
    expect(event).toHaveBeenLastCalledWith(action);
    const image = {
      id: 'slot-image',
      kind: 'image' as const,
      name: 'slot image',
      url: '/slot',
      source: 'web' as const,
    };
    const calls = assets.mock.calls.length;
    act(() => mocks.socketReceive?.({ t: 'asset.added', asset: image }));
    await waitFor(() => expect(assets).toHaveBeenCalledTimes(calls + 1));
    expect(assets).toHaveBeenLastCalledWith([image]);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });
});

describe('Fatal GPU preview recovery UI (mocked initialization only)', () => {
  it('shows nested causes accessibly, hides inactive canvas, and blocks playback but preserves seek/edit controls', async () => {
    mocks.init.mockRejectedValueOnce(
      new AggregateError(
        [
          new Error('No available renderer for the current environment'),
          new Error('WebGL fallback unavailable', {
            cause: new Error('backend unavailable'),
          }),
        ],
        'WebGPU/WebGL preview initialization failed',
      ),
    );
    render(
      <StudioShell
        sessionId="s"
        snapshot={{ ...snapshot, status: 'awaiting_review', actionIds: ['a'] }}
      />,
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Preview unavailable');
    expect(alert).toHaveTextContent('No available renderer');
    expect(alert).toHaveTextContent('WebGL fallback unavailable');
    expect(alert).toHaveTextContent('backend unavailable');
    expect(alert).toHaveTextContent('GPU-capable browser');
    expect(screen.getByTestId('preview-fallback')).toBe(alert);
    expect(screen.getByTestId('compositor')).toHaveAttribute(
      'data-preview-ready',
      'false',
    );
    expect(screen.getByTestId('compositor')).toHaveAttribute(
      'data-preview-status',
      'unavailable',
    );
    expect(screen.queryByText('preview approx.')).not.toBeInTheDocument();
    expect(screen.getByTestId('compositor')).toHaveAttribute(
      'data-preparing',
      'false',
    );
    expect(
      screen.getByTestId('compositor-canvas').parentElement,
    ).toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: 'play preview' })).toBeDisabled();
    for (const key of [' ', 'j', 'l', 'k']) fireEvent.keyDown(window, { key });
    expect(useStudio.getState()).toMatchObject({
      previewStatus: 'unavailable',
      playing: false,
      shuttle: 0,
    });
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
    expect(useStudio.getState().playhead).toBe(1);
    expect(screen.getByRole('button', { name: /finish/i })).toBeEnabled();
    act(() => useStudio.setState({ fullscreen: true }));
    expect(
      screen
        .getAllByRole('button', { name: 'play preview' })
        .every((button) => button.hasAttribute('disabled')),
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'close preview' })).toBeEnabled();
  });
  it('stays initializing until init resolves and does not become ready after an abandoned mount', async () => {
    let resolve!: () => void;
    mocks.init.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const bridgeRef = React.createRef<StudioCompositorHandle>();
    const view = render(
      <StudioCompositor project={project} assets={[]} bridgeRef={bridgeRef} />,
    );
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    expect(useStudio.getState().previewStatus).toBe('initializing');
    act(() => useStudio.getState().requestPlayback(true));
    expect(useStudio.getState().playing).toBe(false);
    view.unmount();
    await act(async () => resolve());
    expect(useStudio.getState().previewStatus).toBe('legacy');
  });
  it('preserves ready state on a same-session snapshot refresh without reinitializing the renderer', async () => {
    const view = render(<StudioShell sessionId="s" snapshot={snapshot} />);
    await waitFor(() =>
      expect(useStudio.getState().previewStatus).toBe('ready'),
    );
    view.rerender(
      <StudioShell
        sessionId="s"
        snapshot={{ ...snapshot, status: 'awaiting_review' }}
      />,
    );
    expect(useStudio.getState().previewStatus).toBe('ready');
    expect(mocks.init).toHaveBeenCalledTimes(1);
  });
  it('becomes ready only after successful initialization and resets fatal status for a new session', async () => {
    useStudio.getState().setPreviewStatus('error');
    const bridgeRef = React.createRef<StudioCompositorHandle>();
    render(
      <StudioCompositor project={project} assets={[]} bridgeRef={bridgeRef} />,
    );
    await waitFor(() =>
      expect(useStudio.getState().previewStatus).toBe('ready'),
    );
    expect(screen.queryByTestId('preview-fallback')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('compositor-canvas').parentElement,
    ).not.toHaveAttribute('hidden');
    act(() => useStudio.getState().requestPlayback(true));
    expect(useStudio.getState().playing).toBe(true);
  });
});

describe('actual-output seam (mocked controller, no audio or GPU acceptance)', () => {
  it('reuses controller playback publications for meter subscribers and releases subscription without a second controller', async () => {
    const ref = React.createRef<StudioCompositorHandle>();
    const view = render(
      <StudioCompositor project={project} assets={[]} bridgeRef={ref} />,
    );
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    expect(ref.current?.getAudioLevel?.()).toMatchObject({
      peak: 0.5,
      rms: 0.25,
      state: 'measuring',
    });
    const sample = vi.fn();
    const stop = ref.current?.subscribeAudioLevel?.(sample);
    act(() => mocks.playback?.(1, true, 30));
    expect(sample).toHaveBeenCalledTimes(1);
    stop?.();
    act(() => mocks.playback?.(2, true, 30));
    expect(sample).toHaveBeenCalledTimes(1);
    expect(mocks.created).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(ref.current).toBeNull();
  });
});

describe('shared poster handle (mocked controller, not GPU acceptance)', () => {
  it('delegates time and cancellation to the sole controller and removes the handle at disposal', async () => {
    const ref = React.createRef<StudioCompositorHandle>();
    const view = render(
      <StudioCompositor project={project} assets={[]} bridgeRef={ref} />,
    );
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    const abort = new AbortController();
    const result = await ref.current?.getFrame?.(1, { signal: abort.signal });
    expect(mocks.getFrame).toHaveBeenCalledWith(1, { signal: abort.signal });
    expect(result).toMatchObject({
      projectVersion: 1,
      time: 1,
      width: 640,
      height: 360,
    });
    expect(mocks.created).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(ref.current).toBeNull();
  });
});

describe('historical cut projection (mocked controller, no GPU acceptance)', () => {
  const cut: KimoProject = {
    ...project,
    version: 0,
    width: 1080,
    height: 1920,
  };
  const cutAssets = [
    {
      id: 'cut-image',
      kind: 'image' as const,
      name: 'cut',
      source: 'user' as const,
      url: '/cut.png',
    },
  ];
  const liveAssets = cutAssets.map((asset) => ({
    ...asset,
    id: 'live-image',
    url: '/live.png',
  }));
  const action: ServerEvent = {
    t: 'agent.action.start',
    id: 'historical-action',
    tool: 'trim',
    title: 'trim',
    args: {},
    target: { clipId: 'text', time: 3 },
  };
  it('switches cuts on the sole controller, fences live ingress, then restores CURRENT live projection and registry', async () => {
    const ref = React.createRef<StudioCompositorHandle>();
    const view = render(
      <StudioCompositor project={project} assets={[]} bridgeRef={ref} />,
    );
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    const canvas = screen.getByTestId('compositor-canvas');
    view.rerender(
      <StudioCompositor
        project={cut}
        assets={cutAssets}
        historical
        bridgeRef={ref}
      />,
    );
    expect(mocks.updateProject).toHaveBeenLastCalledWith(cut);
    expect(mocks.assets).toHaveBeenLastCalledWith(cutAssets);
    const count = mocks.updateProject.mock.calls.length;
    const assetsCount = mocks.assets.mock.calls.length;
    const currentLive = { ...project, version: 7 };
    act(() => {
      useProject.getState().replace(currentLive);
      ref.current?.assets(liveAssets);
      ref.current?.event(action);
      ref.current?.event({
        t: 'sam.mask',
        actionId: action.id,
        clipId: 'text',
        maskAssetId: 'live-mask',
        previewPolygon: [],
      });
      useStudio.getState().seek(2);
    });
    expect(mocks.updateProject).toHaveBeenCalledTimes(count);
    expect(mocks.assets).toHaveBeenCalledTimes(assetsCount);
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.transport).toHaveBeenLastCalledWith(
      expect.objectContaining({ followKimo: false }),
      2,
    );
    const secondCut = { ...cut, version: 2 };
    view.rerender(
      <StudioCompositor
        project={secondCut}
        assets={cutAssets}
        historical
        bridgeRef={ref}
      />,
    );
    expect(mocks.updateProject).toHaveBeenLastCalledWith(secondCut);
    expect(useProject.getState().project).toBe(currentLive);
    // Model the real controller's existing project-version reporting, not a bridge relabel.
    mocks.getFrame.mockImplementationOnce(async () => ({
      blob: new Blob(['mock']),
      time: 1,
      projectVersion: mocks.previewProject?.version ?? -1,
      width: 640,
      height: 360,
      approximations: [],
    }));
    expect(await ref.current?.getFrame?.(1)).toMatchObject({
      projectVersion: 2,
    });
    // Even a stale project prop cannot restore an old live projection on exit.
    view.rerender(
      <StudioCompositor
        project={project}
        assets={liveAssets}
        bridgeRef={ref}
      />,
    );
    expect(mocks.updateProject).toHaveBeenLastCalledWith(currentLive);
    expect(mocks.assets).toHaveBeenLastCalledWith(liveAssets);
    act(() => ref.current?.event(action));
    expect(mocks.event).toHaveBeenLastCalledWith(action);
    expect(mocks.created).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).not.toHaveBeenCalled();
    expect(screen.getByTestId('compositor-canvas')).toBe(canvas);
    view.unmount();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
  it('retains incoming live registry for exit without replaying historical action packets', async () => {
    const ref = React.createRef<StudioCompositorHandle>();
    const view = render(
      <StudioCompositor
        project={cut}
        assets={cutAssets}
        historical
        bridgeRef={ref}
      />,
    );
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    expect(mocks.previewProject).toBe(cut);
    expect(screen.getByLabelText('historical cut preview')).toBeInTheDocument();
    expect(screen.queryByTestId('compositor-guides')).not.toBeInTheDocument();
    act(() => {
      ref.current?.assets(liveAssets);
      ref.current?.event(action);
    });
    // An unchanged array identity must not erase the latest ingress registry.
    view.rerender(
      <StudioCompositor project={project} assets={cutAssets} bridgeRef={ref} />,
    );
    expect(mocks.assets).toHaveBeenLastCalledWith(liveAssets);
    expect(mocks.updateProject).toHaveBeenLastCalledWith(
      useProject.getState().project,
    );
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.created).toHaveBeenCalledTimes(1);
    view.unmount();
  });
  it('initializes from latest historical props and never overwrites them with live store or queued actions', async () => {
    const ref = React.createRef<StudioCompositorHandle>();
    const view = render(
      <StudioCompositor project={project} assets={[]} bridgeRef={ref} />,
    );
    act(() => ref.current?.event(action));
    view.rerender(
      <StudioCompositor
        project={cut}
        assets={cutAssets}
        historical
        bridgeRef={ref}
      />,
    );
    act(() => ref.current?.assets(liveAssets));
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    expect(mocks.created).toHaveBeenLastCalledWith(cut, cutAssets);
    expect(mocks.previewProject).toBe(cut);
    expect(mocks.event).not.toHaveBeenCalled();
    expect(
      mocks.transport.mock.calls.some(
        ([intent]) => intent.followKimo === false,
      ),
    ).toBe(true);
    view.unmount();
  });
  it('updates the existing initializing controller on prop transitions and fences retained ingress after disposal', async () => {
    let resolve!: () => void;
    mocks.init.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const ref = React.createRef<StudioCompositorHandle>();
    const view = render(
      <StudioCompositor project={project} assets={[]} bridgeRef={ref} />,
    );
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    view.rerender(
      <StudioCompositor
        project={cut}
        assets={cutAssets}
        historical
        bridgeRef={ref}
      />,
    );
    expect(mocks.updateProject).toHaveBeenLastCalledWith(cut);
    const retained = ref.current;
    view.unmount();
    const count = mocks.assets.mock.calls.length;
    act(() => {
      retained?.assets(liveAssets);
      retained?.event(action);
    });
    await act(async () => resolve());
    expect(mocks.assets).toHaveBeenCalledTimes(count);
    expect(mocks.event).not.toHaveBeenCalled();
    expect(ref.current).toBeNull();
    expect(useStudio.getState().previewStatus).toBe('legacy');
  });
});
