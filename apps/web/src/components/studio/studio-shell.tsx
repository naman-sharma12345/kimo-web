'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ClientEvent, SessionSnapshot } from '@kimo/client';
import { api } from '@/lib/api';
import { useProject } from '@/stores/project';
import {
  useStudio,
  readPreferences,
  responsiveSizes,
  clampPanel,
  type PanelName,
} from '@/stores/studio';
import { registerStudioKeyboard } from '@/lib/keyboard';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogActions,
} from '@/components/ui/dialog';
import { StudioTopBar, type StudioCommands } from './top-bar';
import {
  AgentPanel,
  ViewerPanel,
  InspectorPanel,
  TimelinePanel,
  type StudioSlots,
} from './panels';
import { Resizer } from './controls';
import { StudioStatusBar } from './status-bar';
import { ShortcutsDialog } from './shortcuts-dialog';
import {
  StudioCompositor,
  type StudioCompositorHandle,
} from './compositor-bridge';
import '@/styles/ui.css';
import '@/styles/studio.css';
export interface StudioShellProps {
  sessionId: string;
  snapshot: SessionSnapshot;
  originalPrompt?: string;
  /** The parent must supply the authenticated user id when authentication lands. */
  userKey?: string;
  slots?: StudioSlots;
  /** A custom compositor slot can share this Shell's one socket and authoritative assets. */
  compositorRef?: React.RefObject<StudioCompositorHandle | null>;
  commands?: Partial<StudioCommands> & {
    keyboard?: (id: string) => boolean | undefined;
  };
  /** Lets a later phase own the live subscription without opening a duplicate socket. */
  subscribe?: boolean;
}
const emptySlots: StudioSlots = {};
const emptyCommands: NonNullable<StudioShellProps['commands']> = {};
export const studioTiming = {
  reconnect: [1000, 2000, 5000],
  handshake: 5000,
} as const;
export function StudioShell({
  sessionId,
  snapshot,
  originalPrompt = '',
  userKey = 'browser-profile',
  slots = emptySlots,
  compositorRef,
  commands = emptyCommands,
  subscribe = true,
}: StudioShellProps) {
  const router = useRouter();
  const state = useStudio();
  const storedProject = useProject((s) => s.project);
  const project =
    storedProject?.id === snapshot.project.id
      ? storedProject
      : snapshot.project;
  const [assets, setAssets] = React.useState(snapshot.assets);
  const [viewport, setViewport] = React.useState({ width: 1920, height: 1080 });
  const [watchTab, setWatchTab] = React.useState('chat');
  const [agentTab, setAgentTab] = React.useState('chat');
  const [banner, setBanner] = React.useState(true);
  const [help, setHelp] = React.useState(false);
  const [boundary, setBoundary] = React.useState('');
  const composer = React.useRef<HTMLTextAreaElement>(null);
  const viewer = React.useRef<HTMLElement>(null);
  const socket = React.useRef<WebSocket | null>(null);
  const defaultCompositor = React.useRef<StudioCompositorHandle | null>(null);
  const compositor = compositorRef ?? defaultCompositor;
  React.useEffect(() => {
    if (compositorRef) compositorRef.current?.assets(assets);
  }, [assets, compositorRef]);
  React.useEffect(() => {
    useStudio
      .getState()
      .resetSession(
        sessionId,
        snapshot.project.duration,
        snapshot.project.version > 0,
        snapshot.status === 'awaiting_review',
      );
    useStudio.setState({ actionIds: snapshot.actionIds ?? [] });
    useStudio.setState(readPreferences(userKey));
    useProject.getState().replace(snapshot.project);
    setAssets(snapshot.assets);
    const resize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [sessionId, snapshot, userKey]);
  React.useEffect(() => {
    useStudio.setState({ duration: project.duration });
  }, [project.duration]);
  React.useEffect(() => {
    // Selection opens the tablet sheet, but must not override desktop collapse or watch tabs.
    if (
      state.selection.length > 0 &&
      window.innerWidth >= 1024 &&
      window.innerWidth < 1280
    )
      useStudio.setState({ inspectorCollapsed: false });
  }, [state.selection]);
  React.useEffect(() => {
    if (!subscribe || !snapshot.wsUrl) return;
    let disposed = false;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let handshake: ReturnType<typeof setTimeout> | undefined;
    let connection: WebSocket | undefined;
    let projectQueue: Promise<void> = Promise.resolve();
    const url = snapshot.wsUrl;
    function retry() {
      clearTimeout(handshake);
      if (disposed) return;
      useStudio.setState({ connection: 'reconnecting' });
      const delay = studioTiming.reconnect[retries++];
      if (delay === undefined) {
        useStudio.setState({ connection: 'disconnected' });
        return;
      }
      retryTimer = setTimeout(connect, delay);
    }
    function connect() {
      if (disposed) return;
      useStudio.setState({
        connection: retries ? 'reconnecting' : 'connecting',
      });
      try {
        connection = api.connect(
          url,
          (event) => {
            if (disposed) return;
            if (event.t !== 'asset.added' && event.t !== 'project.ops')
              compositor.current?.event(event);
            useStudio.getState().receive(event);
            if (event.t === 'asset.added')
              setAssets((current) => [
                ...current.filter((a) => a.id !== event.asset.id),
                event.asset,
              ]);
            if (event.t === 'project.ops') {
              const current = useProject.getState().project;
              if (current && event.version <= current.version) return;
              compositor.current?.event(event);
              // Serialize authoritative refetches with contiguous events. A refetch replaces
              // the asset registry too, and never reapplies the same op batch.
              projectQueue = projectQueue
                .then(async () => {
                  if (disposed) return;
                  const latest = useProject.getState().project;
                  if (latest && event.version <= latest.version) return;
                  if (!latest || event.version !== latest.version + 1) {
                    const restored = await api.session(sessionId);
                    if (disposed) return;
                    if (restored.project.version < event.version)
                      throw new Error(
                        'authoritative snapshot is behind the event',
                      );
                    const newest = useProject.getState().project;
                    if (
                      newest?.id === restored.project.id &&
                      newest.version > restored.project.version
                    )
                      return;
                    useProject.getState().replace(restored.project);
                    setAssets(restored.assets);
                  } else
                    await useProject
                      .getState()
                      .receive(sessionId, event.version, event.ops);
                })
                .catch(() => {
                  if (!disposed)
                    setBoundary(
                      'project sync failed; reload this session to restore the authoritative edit.',
                    );
                });
            }
          },
          retry,
        );
        socket.current = connection;
        const current = connection;
        current.onopen = () => {
          if (disposed) return;
          clearTimeout(handshake);
          retries = 0;
          useStudio.setState({ connection: 'connected' });
        };
        handshake = setTimeout(() => {
          if (current.readyState !== WebSocket.OPEN) current.close();
        }, studioTiming.handshake);
      } catch {
        retry();
      }
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearTimeout(handshake);
      connection?.close();
      socket.current = null;
    };
  }, [sessionId, snapshot.wsUrl, subscribe, compositor]);
  const togglePanel = React.useCallback(
    (panel: PanelName) => {
      useStudio.getState().togglePanel(panel);
      useStudio.getState().persist(userKey);
    },
    [userKey],
  );
  const pauseAgent = React.useCallback(() => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const paused = useStudio.getState().agent === 'paused';
    const message: ClientEvent = { t: paused ? 'resume' : 'pause' };
    ws.send(JSON.stringify(message));
    // Protocol has no pause acknowledgement; expose the sent local intent, not server confirmation.
    useStudio.setState({ agent: paused ? 'thinking' : 'paused' });
  }, []);
  const fullscreen = React.useCallback(() => {
    if (commands.fullscreen) {
      commands.fullscreen();
      return;
    }
    if (
      document.fullscreenElement &&
      document.fullscreenElement !== viewer.current &&
      !useStudio.getState().fullscreen
    )
      return;
    if (
      !Object.keys(project.clips).length ||
      (slots.viewer && !compositorRef)
    ) {
      if (document.fullscreenElement === viewer.current)
        void document
          .exitFullscreen?.()
          .catch(() => setBoundary('fullscreen could not close.'));
      else
        void viewer.current
          ?.requestFullscreen?.()
          .catch(() => setBoundary('fullscreen unavailable.'));
      return;
    }
    useStudio.setState({ fullscreen: !useStudio.getState().fullscreen });
  }, [commands, project.clips, slots.viewer, compositorRef]);
  React.useEffect(
    () =>
      registerStudioKeyboard((id) => {
        const current = useStudio.getState();
        if (commands.keyboard?.(id) === true) return true;
        if (id === 'escape' && current.fullscreen) {
          useStudio.setState({ fullscreen: false });
          return true;
        }
        if (id === 'help') {
          setHelp(true);
          return;
        }
        // Keep Dialog's focus trap and Escape handling authoritative.
        if (document.querySelector('[role="dialog"]')) return false;
        if (id === 'composer') {
          useStudio.setState({ agentCollapsed: false });
          setWatchTab('chat');
          setAgentTab('chat');
          requestAnimationFrame(() => composer.current?.focus());
          return;
        }
        if (id === 'pause-agent') {
          (commands.pauseAgent ?? pauseAgent)();
          return;
        }
        if (id === 'fullscreen') {
          fullscreen();
          return;
        }
        if (id === 'play') {
          useStudio.setState({ playing: !current.playing });
          return;
        }
        if (id.startsWith('shuttle-')) {
          const shuttle = id === 'shuttle-j' ? -1 : id === 'shuttle-l' ? 1 : 0;
          useStudio.setState({ shuttle, playing: shuttle !== 0 });
          return;
        }
        if (id === 'frame-back')
          current.seek(current.playhead - 1 / project.fps);
        else if (id === 'frame-next')
          current.seek(current.playhead + 1 / project.fps);
        else if (id === 'second-back') current.seek(current.playhead - 1);
        else if (id === 'second-next') current.seek(current.playhead + 1);
        else if (id === 'start') current.seek(0);
        else if (id === 'end') current.seek(current.duration);
        else if (id === 'i') useStudio.setState({ inPoint: current.playhead });
        else if (id === 'o') useStudio.setState({ outPoint: current.playhead });
        else if (id === 's')
          useStudio.setState({ snapping: !current.snapping });
        else if (id === 'fit') useStudio.setState({ zoom: 1 });
        else if (['v', 'b', 'y', 't'].includes(id))
          useStudio.setState({
            tool: ({ v: 'select', b: 'blade', y: 'slip', t: 'text' } as const)[
              id as 'v' | 'b' | 'y' | 't'
            ],
          });
        else if (id === 'escape') {
          composer.current?.blur();
          return false;
        } else if (id === 'undo' && commands.undo) commands.undo();
        else if (id === 'redo' && commands.redo) commands.redo();
        else {
          setBoundary(
            id === 'submit'
              ? 'sending connects in Phase 8'
              : 'editing commands connect in Phase 7',
          );
        }
      }),
    [commands, pauseAgent, fullscreen, project.fps],
  );
  const responsive = responsiveSizes(viewport.width);
  const sizes = Object.fromEntries(
    (['agent', 'inspector', 'timeline'] as const).map((panel) => [
      panel,
      clampPanel(
        panel,
        state.sizes[panel] ?? responsive[panel],
        viewport.height,
      ),
    ]),
  ) as unknown as Record<PanelName, number>;
  // Side sizes are independently persisted but must leave 560px for the viewer at this width.
  const inspectorWidth =
    state.inspectorCollapsed || viewport.width < 1280 ? 0 : sizes.inspector;
  const agentWidth = state.agentCollapsed
    ? 48
    : Math.min(
        sizes.agent,
        Math.max(300, viewport.width - inspectorWidth - 560 - 32),
      );
  const effectiveInspector = Math.min(
    inspectorWidth,
    Math.max(280, viewport.width - agentWidth - 560 - 32),
  );
  const style = {
    '--studio-agent-size': `${agentWidth}px`,
    '--studio-inspector-size': `${effectiveInspector}px`,
    '--studio-timeline-size': `${state.timelineCollapsed ? 36 : sizes.timeline}px`,
  } as React.CSSProperties;
  return (
    <main
      className="studio-shell"
      style={style}
      data-ready="true"
      data-watch-tab={watchTab}
      data-agent-collapsed={state.agentCollapsed || undefined}
      data-inspector-collapsed={state.inspectorCollapsed || undefined}
      data-testid="studio-shell"
      aria-label="video studio"
    >
      <StudioTopBar
        sessionId={sessionId}
        commands={{
          ...commands,
          pauseAgent: commands.pauseAgent ?? pauseAgent,
          fullscreen,
          finish:
            commands.finish ??
            (() => setBoundary('review flow connects in Phase 9')),
        }}
        togglePanel={togglePanel}
        onLeave={() => router.push('/')}
      />
      <div className="studio-watch-banner" hidden={!banner}>
        for full editing, open kimo on a bigger screen
        <Button variant="ghost" size="xs" onClick={() => setBanner(false)}>
          dismiss
        </Button>
      </div>
      <div className="studio-workspace" data-testid="studio-workspace">
        <div className="studio-upper">
          <AgentPanel
            prompt={originalPrompt}
            slots={slots}
            composerRef={composer}
            toggle={() => togglePanel('agent')}
            tab={agentTab}
            setTab={setAgentTab}
            watchMode={viewport.width < 1024}
          />
          <Resizer panel="agent" value={agentWidth} userKey={userKey} />
          <ViewerPanel
            project={project}
            assets={assets}
            slots={{
              ...slots,
              viewer:
                slots.viewer ??
                (Object.keys(project.clips).length ? (
                  <StudioCompositor
                    key={sessionId}
                    project={project}
                    assets={assets}
                    bridgeRef={compositor}
                    debug={
                      typeof window !== 'undefined' &&
                      new URLSearchParams(window.location.search).get(
                        'debug',
                      ) === '1'
                    }
                  />
                ) : undefined),
            }}
            viewerRef={viewer}
          />
          {!state.inspectorCollapsed && (
            <>
              <Resizer
                panel="inspector"
                value={sizes.inspector}
                userKey={userKey}
              />
              <InspectorPanel project={project} assets={assets} slots={slots} />
            </>
          )}
        </div>
        <div className="studio-watch-tabs">
          <Tabs
            value={watchTab}
            onValueChange={(tab) => {
              setWatchTab(tab);
              if (tab === 'chat') useStudio.setState({ agentCollapsed: false });
              if (tab === 'edit')
                useStudio.setState({ inspectorCollapsed: false });
            }}
          >
            <TabsList aria-label="watch mode panels">
              <TabsTrigger value="chat">chat</TabsTrigger>
              <TabsTrigger value="timeline">timeline</TabsTrigger>
              <TabsTrigger value="edit">edit</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Resizer panel="timeline" value={sizes.timeline} userKey={userKey} />
        <TimelinePanel
          project={project}
          slots={slots}
          toggle={() => togglePanel('timeline')}
        />
      </div>
      <StudioStatusBar />
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
      <Dialog
        open={!!boundary}
        onOpenChange={(open) => {
          if (!open) setBoundary('');
        }}
      >
        <DialogContent>
          <DialogTitle>studio shell</DialogTitle>
          <DialogDescription>{boundary}</DialogDescription>
          <DialogActions>
            <Button onClick={() => setBoundary('')}>close</Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </main>
  );
}
