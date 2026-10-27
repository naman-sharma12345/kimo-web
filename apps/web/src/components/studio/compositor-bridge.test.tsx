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
import {
  StudioCompositor,
  type StudioCompositorHandle,
} from './compositor-bridge';
import { StudioShell } from './studio-shell';
const mocks = vi.hoisted(() => ({
  created: vi.fn(),
  init: vi.fn(async () => undefined),
  dispose: vi.fn(),
  event: vi.fn(),
  assets: vi.fn(),
  updateProject: vi.fn(),
  transport: vi.fn(),
  resize: vi.fn(),
  session: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  socketReceive: undefined as ((event: ServerEvent) => void) | undefined,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
    constructor() {
      mocks.created();
    }
    init = mocks.init;
    dispose = mocks.dispose;
    event = mocks.event;
    setAssets = mocks.assets;
    updateProject = mocks.updateProject;
    setTransport = mocks.transport;
    resize = mocks.resize;
    getResource = () => undefined;
    getFilmstrip = vi.fn();
    getWaveform = vi.fn();
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
  vi.clearAllMocks();
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
    expect(mocks.assets).toHaveBeenLastCalledWith([asset]);
  });
});

describe('Authoritative snapshot bridge', () => {
  it('serializes a contiguous op then refetches project and assets on a gap, without replaying ops twice', async () => {
    const receive = vi.spyOn(useProject.getState(), 'receive');
    const asset = {
      id: 'new',
      name: 'authoritative image',
      kind: 'image' as const,
      source: 'user' as const,
      url: '/new',
    };
    mocks.session.mockResolvedValue({
      ...snapshot,
      project: { ...project, version: 5 },
      assets: [asset],
    });
    const view = render(<StudioShell sessionId="s" snapshot={snapshot} />);
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    act(() => mocks.socketReceive?.({ t: 'project.ops', version: 2, ops: [] }));
    await waitFor(() => expect(useProject.getState().project?.version).toBe(2));
    expect(receive).toHaveBeenCalledTimes(1);
    act(() => mocks.socketReceive?.({ t: 'project.ops', version: 5, ops: [] }));
    await waitFor(() => expect(useProject.getState().project?.version).toBe(5));
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledTimes(1);
    expect(mocks.assets).toHaveBeenLastCalledWith([asset]);
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
    expect(mocks.connect).toHaveBeenCalledTimes(1);
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
    expect(event).toHaveBeenCalledTimes(1);
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
