'use client';
import * as React from 'react';
import { analytics, diagnosticsTiming, assetCounts } from '@/lib/diagnostics';
import { useRouter } from 'next/navigation';
import type { SessionSnapshot } from '@kimo/client';
import type { ComparisonState } from '@kimo/compositor';
import { api } from '@/lib/api';
import { useProject } from '@/stores/project';
import { useEditing } from '@/stores/editing';
import { createIndexedDBEditPersistence } from '@/lib/editing/indexeddb';
import { createSessionRecovery, recoveryTiming } from '@/lib/session-recovery';
import { sessionDestination } from '@/lib/uploads/session';
import {
  createCutStore,
  cutPreviewState,
  rememberPrompt,
  type LocalCut,
  type LocalStorage,
  type BeatDetection,
  projectBeats,
} from '@/lib/studio-finish';
import { createReadOnlyEditing } from '@/lib/studio-finish/readonly-editing';
import {
  planCutRestore,
  type CutRestorePlan,
} from '@/lib/studio-finish/cut-restore';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  CommandPalette,
  CutsMenu,
  CutPreviewBanner,
  CompareControl,
  ShortcutsCoachmarks,
  BeatToggle,
  type CoachStep,
} from '@/components/studio/finish';
import { TimelineEditor, type TimelineInlineTextProps } from './timeline';
import { TimelineTextEditor, isCaptionClip } from './text-editing';
import { InspectorEditor, type LevelMeterAPI } from './inspector';
import { useUploads } from '@/lib/uploads';
import { useSession } from '@/stores/session';
import { attachSessionUploads } from './session-upload';
import { withBuiltinAssets, builtinLutIds } from './builtin-assets';
import { copyClips, pasteClips, type ClipClipboard } from './edit-clipboard';
import { addTextAtPlayhead } from './add-text-command';
import { ReplaceMediaDialog } from './replace-media-dialog';
import { actionProperties } from './action-properties';
import {
  ReviewPrompt,
  ReviewDialog,
  ActingRenderDialog,
  type PosterResult,
} from './review';
import { setRenderPoster, deliveryTransition } from '@/lib/render/handoff';
import { approveCut, reconcileApproval } from '@/lib/studio-approval';
import { clipLabel } from '@/lib/editing/display';
import { createAgentController } from '@/lib/agent/controller';
import {
  createAgentNotificationController,
  type AgentNotificationController,
} from '@/lib/agent/notifications';
import {
  ChatStream,
  type AgentPresentationCallbacks,
} from './agent/chat-stream';
import { ActionsTable } from './agent/actions-table';
import { AgentComposer, type AgentComposerHandle } from './agent/composer';
import { NotificationPrompt } from './agent/notification-prompt';
import { LiveAnnouncer } from './agent/live-announcer';
import type { ComposerAttachment } from '@/lib/agent/composer-model';
import type { PropertyActivity } from './inspector';
import {
  deleteClips,
  duplicateClips,
  splitClips,
} from '@/lib/editing/commands';
import { useOptionalToast } from '@/components/ui/toast';
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
  /** Producer-detected source times only; absent means beat detection unavailable. */
  beatDetections?: readonly BeatDetection[];
}
function TimelineTextAdapter({
  clip,
  editing,
  onClose,
}: TimelineInlineTextProps) {
  return (
    <TimelineTextEditor
      clip={clip}
      editing={editing}
      onFinish={() => onClose()}
    />
  );
}
const emptySlots: StudioSlots = {};
const emptyCommands: NonNullable<StudioShellProps['commands']> = {};
const emptyBeatDetections: readonly BeatDetection[] = [];
export const studioTiming = {
  reconnect: recoveryTiming.backoff,
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
  beatDetections = emptyBeatDetections,
}: StudioShellProps) {
  const router = useRouter();
  const state = useStudio();
  const liveEditingState = useEditing((s) => s.state);
  const liveEditingSession = useEditing((s) => s.session);
  const [previewCut, setPreviewCut] = React.useState<LocalCut | null>(null);
  const previewCutRef = React.useRef<LocalCut | null>(null);
  previewCutRef.current = previewCut;
  const [comparisonCut, setComparisonCut] = React.useState<LocalCut | null>(
    null,
  );
  const comparisonCutRef = React.useRef<LocalCut | null>(null);
  comparisonCutRef.current = comparisonCut;
  const [comparisonSplit, setComparisonSplit] = React.useState(0.5);
  const [comparisonStatus, setComparisonStatus] =
    React.useState<Readonly<ComparisonState> | null>(null);
  const [restoreReview, setRestoreReview] = React.useState<{
    cut: LocalCut;
    plan: Extract<CutRestorePlan, { available: true }>;
  } | null>(null);
  const [restorePending, setRestorePending] = React.useState(false);
  const restoreLock = React.useRef(false);
  const [cuts, setCuts] = React.useState<readonly LocalCut[]>([]);
  const cutsStore = React.useRef<ReturnType<typeof createCutStore> | null>(
    null,
  );
  const [localStorageAdapter, setLocalStorageAdapter] =
    React.useState<LocalStorage>();
  const [recentPrompts, setRecentPrompts] = React.useState<readonly string[]>(
    [],
  );
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [beatGridEnabled, setBeatGridEnabled] = React.useState(false);
  const [coachAnchors, setCoachAnchors] = React.useState<
    Record<CoachStep, HTMLElement | null>
  >({ agent: null, viewer: null, finish: null });
  const toasts = useOptionalToast();
  const toastRef = React.useRef(toasts);
  toastRef.current = toasts;
  const storedProject = useProject((s) => s.project);
  const liveProject =
    storedProject?.id === snapshot.project.id
      ? storedProject
      : snapshot.project;
  const [liveAssets, setAssets] = React.useState(snapshot.assets);
  const preview = React.useMemo(
    () => (previewCut ? cutPreviewState(previewCut) : null),
    [previewCut],
  );
  const project = preview?.project ?? liveProject;
  const assets = preview?.assets ?? liveAssets;
  const comparisonProjection = React.useMemo(
    () => (comparisonCut ? cutPreviewState(comparisonCut) : null),
    [comparisonCut],
  );
  const comparisonAssets = React.useMemo(
    () =>
      comparisonProjection
        ? withBuiltinAssets(comparisonProjection.assets)
        : [],
    [comparisonProjection],
  );
  const comparisonInput = React.useMemo(
    () =>
      comparisonCut && comparisonProjection
        ? {
            id: comparisonCut.id,
            project: comparisonProjection.project,
            assets: comparisonAssets,
            split: comparisonSplit,
          }
        : null,
    [comparisonCut, comparisonProjection, comparisonAssets, comparisonSplit],
  );
  const readonlyView = !!previewCut || !!comparisonCut;
  const detectedBeats = React.useMemo(
    () => projectBeats(project, beatDetections),
    [project, beatDetections],
  );
  const editingSession = React.useMemo(
    () =>
      readonlyView && liveEditingSession
        ? createReadOnlyEditing(
            liveEditingSession,
            project,
            assets,
            comparisonCut
              ? 'comparison is read-only'
              : 'historical cut preview is read-only',
          )
        : liveEditingSession,
    [readonlyView, comparisonCut, project, assets, liveEditingSession],
  );
  const editingState = readonlyView
    ? (editingSession?.getState() ?? liveEditingState)
    : liveEditingState;
  const restorePlan = React.useMemo(
    () =>
      previewCut && liveEditingState
        ? planCutRestore(
            { sessionId, ...liveEditingState },
            previewCut,
            liveEditingState.assets,
          )
        : null,
    [sessionId, previewCut, liveEditingState, liveAssets],
  );
  React.useEffect(() => {
    let storage: LocalStorage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      /* Session-only cuts remain explicit. */
    }
    const store = createCutStore(storage);
    cutsStore.current = store;
    setLocalStorageAdapter(storage);
    setCuts(store.list(sessionId));
    setRecentPrompts(rememberPrompt(storage, ''));
    setPreviewCut(null);
    setComparisonCut(null);
    setComparisonStatus(null);
    setRestoreReview(null);
    return () => {
      if (cutsStore.current === store) cutsStore.current = null;
    };
  }, [sessionId]);
  const rendererAssets = React.useMemo(
    () => (slots.viewer ? assets : withBuiltinAssets(assets)),
    [assets, slots.viewer],
  );
  const [viewport, setViewport] = React.useState({ width: 1920, height: 1080 });
  const [watchTab, setWatchTab] = React.useState('chat');
  const [agentTab, setAgentTab] = React.useState('chat');
  const [banner, setBanner] = React.useState(true);
  const [help, setHelp] = React.useState(false);
  const [boundary, setBoundary] = React.useState('');
  const [reviewComposer, setReviewComposer] = React.useState(false);
  const [reviewMode, setReviewMode] = React.useState<
    'closed' | 'acting' | 'review'
  >('closed');
  const [approvalPending, setApprovalPending] = React.useState(false);
  const [approvalUnknown, setApprovalUnknown] = React.useState<{
    baselineRenderId?: string;
  } | null>(null);
  const approvalLock = React.useRef(false);
  const approvalLife = React.useRef<AbortController | null>(null);
  const pauseObservers = React.useRef(new Set<() => void>());
  React.useEffect(() => {
    const life = new AbortController();
    approvalLife.current = life;
    setReviewMode('closed');
    setApprovalPending(false);
    setApprovalUnknown(null);
    approvalLock.current = false;
    return () => {
      life.abort();
      pauseObservers.current.forEach((done) => done());
      pauseObservers.current.clear();
    };
  }, [sessionId]);
  const [activity, setActivity] = React.useState('');
  const [projectTitle, setProjectTitle] = React.useState('untitled video');
  React.useEffect(() => {
    try {
      setProjectTitle(
        localStorage.getItem(`kimo-studio-title:v1:${sessionId}`) ||
          snapshot.title ||
          'untitled video',
      );
    } catch {
      setProjectTitle(snapshot.title || 'untitled video');
    }
  }, [sessionId, snapshot.title]);
  const activeClipId = state.activeAction?.target?.clipId ?? null;
  const [propertyActivity, setPropertyActivity] = React.useState<
    readonly PropertyActivity[]
  >([]);
  const [agentChange, setAgentChange] = React.useState<
    { id: string; ops: readonly import('@kimo/client').Op[] } | undefined
  >(undefined);
  const [timelineZoom, setTimelineZoom] = React.useState<number | null>(null);
  const [replacement, setReplacement] = React.useState<{
    clipId: string;
    mode: 'search' | 'upload' | 'all';
  } | null>(null);
  const [selectedTrackId, setSelectedTrackId] = React.useState<string | null>(
    null,
  );
  const [textEditingId, setTextEditingId] = React.useState<string | null>(null);
  const clipboard = React.useRef<ClipClipboard | null>(null);
  const composer = React.useRef<HTMLTextAreaElement>(null);
  const agentComposer = React.useRef<AgentComposerHandle>(null);
  const assetsRef = React.useRef(assets);
  assetsRef.current = liveAssets;
  const notificationRef = React.useRef<AgentNotificationController | null>(
    null,
  );
  const [notifications, setNotifications] =
    React.useState<AgentNotificationController | null>(null);
  const [chatAttachments, setChatAttachments] = React.useState<
    readonly ComposerAttachment[]
  >([]);
  const viewer = React.useRef<HTMLElement>(null);
  const socket = React.useRef<WebSocket | null>(null);
  const transportReady = React.useRef(false);
  const uploadLife = React.useRef<AbortController | null>(null);
  const agentController = React.useMemo(
    () =>
      createAgentController(
        { sessionId, originalPrompt, actionIds: snapshot.actionIds },
        {
          assets: () => assetsRef.current,
          acting: () => useStudio.getState().agent === 'acting',
          message: async (text) => {
            const observation = diagnosticsTiming.beginPrompt({
              length: text.length,
              file_counts: assetCounts(
                agentController
                  .getSnapshot()
                  .items.filter((item) => item.kind === 'user')
                  .reverse()
                  .find((item) => item.delivery === 'sending')?.attachments ??
                  [],
              ),
            });
            observation.bind(sessionId);
            try {
              await api.message(sessionId, text);
            } catch (error) {
              observation.cancel();
              throw error;
            }
          },
          send: (packet) => {
            const current = socket.current;
            if (!current || current.readyState !== WebSocket.OPEN) return false;
            current.send(JSON.stringify(packet));
            if (packet.t === 'interrupt') {
              analytics.track('interrupt_sent', {});
              diagnosticsTiming
                .beginPrompt({
                  length: packet.text.length,
                  file_counts: assetCounts(
                    agentController
                      .getSnapshot()
                      .items.filter((item) => item.kind === 'user')
                      .reverse()
                      .find((item) => item.delivery === 'sending')
                      ?.attachments ?? [],
                  ),
                })
                .bind(sessionId);
            }
            return true;
          },
          userSent: () => notificationRef.current?.userSent(),
          attention: (event) => notificationRef.current?.attention(event),
          intent: (agent) => useStudio.setState({ agent, agentLabel: '' }),
        },
      ),
    [sessionId, originalPrompt, snapshot.actionIds],
  );
  const conversation = React.useSyncExternalStore(
    agentController.subscribe,
    agentController.getSnapshot,
    agentController.getSnapshot,
  );
  React.useEffect(() => {
    agentController.restoreHistory(snapshot.agentHistory);
  }, [agentController, snapshot.agentHistory]);
  const liveAgent = React.useRef(agentController);
  React.useEffect(() => {
    liveAgent.current = agentController;
    const controller = createAgentNotificationController();
    notificationRef.current = controller;
    setNotifications(controller);
    setChatAttachments([]);
    return () => {
      controller.dispose();
      if (notificationRef.current === controller)
        notificationRef.current = null;
      // React's development effect replay must not permanently dispose this model.
      queueMicrotask(() => {
        if (
          notificationRef.current === null ||
          liveAgent.current !== agentController
        )
          agentController.dispose();
      });
    };
  }, [agentController]);
  const focusComposer = () => {
    agentComposer.current?.focus();
    if (!agentComposer.current) composer.current?.focus();
  };
  const focusTimeline = () => {
    document
      .querySelector<HTMLElement>('[role="grid"][aria-label="timeline editor"]')
      ?.focus();
  };

  const prepareCoachAnchor = React.useCallback((step: CoachStep) => {
    if (step === 'agent') {
      useStudio.setState({ agentCollapsed: false });
      setAgentTab('chat');
      setWatchTab('chat');
    }
  }, []);
  React.useEffect(() => {
    const next = {
      agent: document.querySelector<HTMLElement>(
        '[data-testid="studio-agent"]',
      ),
      viewer: document.querySelector<HTMLElement>(
        '[data-testid="studio-viewer"]',
      ),
      finish: document.querySelector<HTMLElement>('.studio-finish'),
    };
    setCoachAnchors((old) =>
      old.agent === next.agent &&
      old.viewer === next.viewer &&
      old.finish === next.finish
        ? old
        : next,
    );
  }, [viewport.width, state.agentCollapsed, state.inspectorCollapsed]);
  const defaultCompositor = React.useRef<StudioCompositorHandle | null>(null);
  const compositor = compositorRef ?? defaultCompositor;
  const reviewPoster = React.useRef<PosterResult | null>(null);
  const recordReviewPoster = React.useCallback(
    (poster: PosterResult | null) => {
      reviewPoster.current = poster;
    },
    [],
  );
  const captureReviewFrame = React.useCallback(
    (time: number, options?: { signal?: AbortSignal }) => {
      const capture = compositor.current?.getFrame;
      if (!capture)
        return Promise.reject(new Error('composited poster is unavailable'));
      return capture(time, options);
    },
    [compositor],
  );

  React.useEffect(() => {
    if (compositorRef) compositorRef.current?.assets(assets);
  }, [assets, compositorRef]);
  React.useEffect(() => {
    const previousPreview = useStudio.getState();
    const previewStatus =
      !slots.viewer && Object.keys(snapshot.project.clips).length
        ? previousPreview.sessionId === sessionId &&
          previousPreview.previewStatus !== 'legacy'
          ? previousPreview.previewStatus
          : 'initializing'
        : 'legacy';
    useStudio
      .getState()
      .resetSession(
        sessionId,
        snapshot.project.duration,
        snapshot.project.version > 0,
        snapshot.status === 'awaiting_review',
      );
    useStudio.getState().setPreviewStatus(previewStatus);
    useStudio.setState({ actionIds: snapshot.actionIds ?? [] });
    useStudio.setState(readPreferences(userKey));
    setSelectedTrackId(null);
    setPropertyActivity([]);
    setAgentChange(undefined);
    const uploadController = new AbortController();
    uploadLife.current = uploadController;
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      /* Denied storage is an explicit unsaved service state. */
    }
    const edit = useProject.getState().attach({
      sessionId,
      project: snapshot.project,
      assets: snapshot.assets,
      client: {
        session: (id, options) => api.session(id, options),
        ops: async (id, ops, version, options) => {
          const result = await api.ops(id, ops, version, options);
          for (const op_type of new Set(ops.map((op) => op.op)))
            analytics.track('user_edit', { op_type });
          return result;
        },
      },
      storage,
      persistence: createIndexedDBEditPersistence(),
      online: () => navigator.onLine && (!subscribe || transportReady.current),
      assetsChanged: (next) => setAssets([...next]),
      activity: (text) => {
        setActivity(text);
        agentController.system(text);
      },
      selectionRemoved: (removed) => {
        useStudio.setState({
          selection: useStudio
            .getState()
            .selection.filter((id) => !removed.includes(id)),
        });
        setTextEditingId((id) => (id && removed.includes(id) ? null : id));
      },
      notifications: {
        toast: (message, action) => {
          if (toastRef.current)
            toastRef.current.notify({
              message,
              action: action
                ? { label: action.label, onClick: action.run }
                : undefined,
            });
          else setBoundary(message);
        },
      },
      messages: {
        send: (text, attachmentIds) =>
          agentController.send({ text, attachmentIds }),
        prefill: (text) => {
          agentComposer.current?.prefill(text);
          focusComposer();
        },
      },
    });
    void edit.ready().then(() => {
      if (
        !uploadController.signal.aborted &&
        (!subscribe || transportReady.current)
      )
        void edit.flush();
    });
    setAssets(snapshot.assets);
    const resize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    resize();
    window.addEventListener('resize', resize);
    return () => {
      uploadController.abort();
      if (uploadLife.current === uploadController) uploadLife.current = null;
      window.removeEventListener('resize', resize);
      if (useEditing.getState().session === edit)
        useProject.getState().dispose();
    };
  }, [sessionId, snapshot, userKey, slots.viewer, agentController]);
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
    transportReady.current = false;
    if (!subscribe) return;
    let disposed = false;
    let projectQueue: Promise<void> = Promise.resolve();
    const runningActions = new Set<string>();
    let eventVersion = useProject.getState().acknowledgedVersion;
    const owner = createSessionRecovery({
      sessionId,
      api,
      onSnapshot(restored) {
        agentController.restoreHistory(restored.agentHistory);
        if (
          restored.project.version > useProject.getState().acknowledgedVersion
        )
          diagnosticsTiming.discard(sessionId);
        eventVersion = restored.project.version;
        const destination = sessionDestination(sessionId, restored);
        if (destination.kind === 'redirect') {
          router.push(destination.href);
          return 'stop';
        }
        if (destination.kind === 'error') {
          setBoundary('this session could not be restored.');
          return 'stop';
        }
        const edit = useEditing.getState().session;
        if (
          edit &&
          edit.getState().acknowledgedVersion > restored.project.version
        )
          throw new Error('authoritative restore is behind acknowledged edits');
        if (edit)
          edit.replaceSnapshot({
            project: restored.project,
            assets: restored.assets,
          });
        else {
          useProject.getState().replace(restored.project);
          setAssets(restored.assets);
        }
        useStudio.setState({
          reviewRequested: restored.status === 'awaiting_review',
        });
        return 'continue';
      },
      onStatus(status) {
        if (disposed) return;
        transportReady.current = status === 'connected';
        useStudio.setState({
          connection:
            status === 'restoring'
              ? 'connecting'
              : status === 'stopped'
                ? 'disconnected'
                : status,
        });
        agentController.connection(status === 'connected');
        if (status === 'connected') {
          const edit = useEditing.getState().session;
          if (edit)
            void edit
              .ready()
              .then(() => {
                if (
                  !disposed &&
                  transportReady.current &&
                  useEditing.getState().session === edit
                )
                  return edit.flush();
              })
              .catch(() => {
                if (!disposed)
                  setBoundary('queued edits could not be restored safely.');
              });
        }
      },
      onSocket(current) {
        socket.current = current ?? null;
      },
      onFatal(failure) {
        if (!disposed) setBoundary(failure.message);
      },
      onEvent: (event) => {
        if (disposed) return;
        if (event.t !== 'asset.added' && event.t !== 'project.ops')
          compositor.current?.event(event);
        useStudio.getState().receive(event);
        agentController.receive(event);
        if (
          event.t === 'agent.status' &&
          event.state === 'idle' &&
          event.label === 'paused'
        )
          pauseObservers.current.forEach((done) => done());
        if (event.t === 'agent.action.start') {
          runningActions.add(event.id);
        }
        if (event.t === 'agent.action.end') {
          runningActions.delete(event.id);
          setPropertyActivity((current) =>
            current.filter((item) => item.actionId !== event.id),
          );
        }
        if (
          event.t === 'project.ops' &&
          event.actionId &&
          runningActions.has(event.actionId)
        ) {
          const authority = useEditing
            .getState()
            .session?.getState().acknowledged;
          if (authority) {
            const changed = actionProperties(
              authority,
              event.ops,
              event.actionId,
            );
            setPropertyActivity((current) => [
              ...current.filter((item) => item.actionId !== event.actionId),
              ...changed,
            ]);
          }
          setAgentChange({
            id: `${event.actionId}:${event.version}`,
            ops: event.ops,
          });
        }
        if (event.t === 'asset.added') {
          const edit = useEditing.getState().session;
          if (edit) {
            const authority = edit.getState();
            edit.replaceSnapshot({
              project: authority.acknowledged,
              assets: [
                ...authority.assets.filter(
                  (asset) => asset.id !== event.asset.id,
                ),
                event.asset,
              ],
            });
          } else
            setAssets((current) => [
              ...current.filter((asset) => asset.id !== event.asset.id),
              event.asset,
            ]);
        }
        if (event.t === 'project.ops') {
          eventVersion = Math.max(eventVersion, event.version);
          const current = useProject.getState().project;
          if (
            current &&
            event.version <= useProject.getState().acknowledgedVersion
          )
            return;
          compositor.current?.event(event);
          // Serialize authoritative refetches with contiguous events. A refetch replaces
          // the asset registry too, and never reapplies the same op batch.
          projectQueue = projectQueue
            .then(async () => {
              if (disposed) return;
              const latest = useProject.getState().project;
              if (
                latest &&
                event.version <= useProject.getState().acknowledgedVersion
              )
                return;
              if (
                !latest ||
                event.version !== useProject.getState().acknowledgedVersion + 1
              ) {
                diagnosticsTiming.discard(sessionId);
                const restored = await api.session(sessionId);
                if (disposed) return;
                if (restored.project.version < event.version)
                  throw new Error('authoritative snapshot is behind the event');
                const newest = useProject.getState().project;
                if (
                  newest?.id === restored.project.id &&
                  useProject.getState().acknowledgedVersion >
                    restored.project.version
                )
                  return;
                const edit = useEditing.getState().session;
                if (edit)
                  edit.replaceSnapshot({
                    project: restored.project,
                    assets: restored.assets,
                  });
                else {
                  useProject.getState().replace(restored.project);
                  setAssets(restored.assets);
                }
              } else {
                const before = useProject.getState().acknowledgedVersion;
                const editing = useEditing.getState().session;
                if (editing)
                  await editing.receiveAuthoritative({
                    version: event.version,
                    ops: event.ops,
                    actionId: event.actionId,
                    author: event.author,
                    clientMutationId: event.clientMutationId,
                  });
                else
                  await useProject
                    .getState()
                    .receive(sessionId, event.version, event.ops);
                if (!disposed)
                  diagnosticsTiming.applied(
                    sessionId,
                    before,
                    useProject.getState().acknowledgedVersion,
                    event,
                  );
              }
            })
            .catch(() => {
              if (!disposed)
                setBoundary(
                  'project sync failed; reload this session to restore the authoritative edit.',
                );
              throw new Error('authoritative project sync failed');
            });
        }
        if (event.t === 'agent.message' && event.kind === 'ask_review') {
          const boundaryVersion = eventVersion;
          const exactBoundary = transportReady.current;
          projectQueue = projectQueue.then(() => {
            const edit = useEditing.getState().session;
            const current = edit?.getState();
            if (disposed || !current) return;
            if (
              !exactBoundary ||
              current.acknowledgedVersion !== boundaryVersion
            ) {
              setActivity(
                'cut snapshot unavailable: the exact review revision was not observed.',
              );
              return;
            }
            const store = cutsStore.current;
            if (!store) return;
            store.capture({
              sessionId,
              requestId: event.id,
              project: current.acknowledged,
              assets: current.assets,
              createdAt: Date.now(),
            });
            setCuts(store.list(sessionId));
          });
        }
        return projectQueue;
      },
    });
    return () => {
      disposed = true;
      transportReady.current = false;
      owner.dispose();
      socket.current = null;
    };
  }, [sessionId, subscribe, compositor, agentController, router]);
  const togglePanel = React.useCallback(
    (panel: PanelName) => {
      useStudio.getState().togglePanel(panel);
      useStudio.getState().persist(userKey);
    },
    [userKey],
  );
  const dispatchAgent = React.useCallback(
    (kind: 'pause' | 'resume' | 'stop') => {
      if (previewCutRef.current || comparisonCutRef.current) {
        setActivity('this cut is read-only.');
        return;
      }
      if (kind === 'resume') agentController.resume();
      else agentController.pause(kind === 'stop');
    },
    [agentController],
  );
  const safeAgentIntent = React.useCallback(
    (kind: 'pause' | 'resume' | 'stop') => {
      try {
        dispatchAgent(kind);
      } catch (error) {
        setBoundary(
          error instanceof Error
            ? error.message
            : 'agent command was not dispatched',
        );
      }
    },
    [dispatchAgent],
  );
  const pauseAgent = React.useCallback(() => {
    safeAgentIntent(
      useStudio.getState().agent === 'paused' ? 'resume' : 'pause',
    );
  }, [safeAgentIntent]);
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
  const routeShortcut = React.useCallback(
    (id: string, allowDialog = false) => {
      const current = useStudio.getState();
      if (
        (previewCutRef.current || comparisonCutRef.current) &&
        [
          'add-text',
          'edit-v',
          'edit-d',
          'delete',
          'delete-lift',
          'split',
          'undo',
          'redo',
          'submit',
          'pause-agent',
        ].includes(id)
      ) {
        setActivity(
          'this cut is read-only. return to the current edit to make changes.',
        );
        return true;
      }
      if (
        !(previewCutRef.current || comparisonCutRef.current) &&
        commands.keyboard?.(id) === true
      )
        return true;
      if (id === 'escape' && current.fullscreen) {
        useStudio.setState({ fullscreen: false });
        return true;
      }
      if (id === 'help') {
        setHelp(true);
        return;
      }
      if (id === 'palette') {
        setPaletteOpen((open) => !open);
        return true;
      }
      // Keep Dialog's focus trap and Escape handling authoritative.
      if (!allowDialog && document.querySelector('[role="dialog"]'))
        return false;
      if (id === 'composer') {
        useStudio.setState({ agentCollapsed: false });
        setWatchTab('chat');
        setAgentTab('chat');
        requestAnimationFrame(() => focusComposer());
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
        current.requestPlayback(!current.playing);
        return;
      }
      if (id.startsWith('shuttle-')) {
        const shuttle = id === 'shuttle-j' ? -1 : id === 'shuttle-l' ? 1 : 0;
        current.requestPlayback(shuttle !== 0, shuttle);
        return;
      }
      if (id === 'add-text') {
        const edit = useEditing.getState().session;
        if (!edit) return false;
        try {
          const { clipId, ops } = addTextAtPlayhead(
            edit.getState().project,
            current.playhead,
          );
          void edit
            .editGroup(ops, 'add text', 'keyboard')
            .then((result) => {
              if (result.status === 'failed')
                setBoundary(result.error ?? 'text could not be added');
            })
            .catch((error: unknown) =>
              setBoundary(
                error instanceof Error
                  ? error.message
                  : 'text could not be added',
              ),
            );
          useStudio.setState({ selection: [clipId] });
          setTextEditingId(clipId);
        } catch (error) {
          setBoundary(
            error instanceof Error ? error.message : 'text could not be added',
          );
        }
        return;
      }
      if (
        [
          'edit-c',
          'edit-v',
          'edit-d',
          'delete',
          'delete-lift',
          'split',
        ].includes(id)
      ) {
        const edit = useEditing.getState().session;
        if (!edit) return false;
        const p = edit.getState().project;
        if (id === 'edit-c') {
          clipboard.current = copyClips(p, current.selection);
          return;
        }
        try {
          const ops =
            id === 'edit-v'
              ? clipboard.current
                ? pasteClips(
                    p,
                    clipboard.current,
                    current.playhead,
                    edit.getState().assets,
                  )
                : []
              : id === 'edit-d'
                ? duplicateClips(p, current.selection)
                : id === 'split'
                  ? splitClips(p, current.selection, current.playhead)
                  : deleteClips(p, current.selection, {
                      lift: id === 'delete-lift',
                    });
          if (ops.length)
            void edit
              .editGroup(
                ops,
                id === 'edit-v'
                  ? 'paste clips'
                  : id === 'edit-d'
                    ? 'duplicate clips'
                    : id === 'split'
                      ? 'split clips'
                      : 'delete clips',
                'keyboard',
              )
              .catch((error: unknown) =>
                setBoundary(
                  error instanceof Error
                    ? error.message
                    : 'edit could not be saved',
                ),
              );
        } catch (error) {
          setBoundary(
            error instanceof Error ? error.message : 'edit is unavailable',
          );
        }
        return;
      }
      if (id === 'frame-back') current.seek(current.playhead - 1 / project.fps);
      else if (id === 'frame-next')
        current.seek(current.playhead + 1 / project.fps);
      else if (id === 'second-back') current.seek(current.playhead - 1);
      else if (id === 'second-next') current.seek(current.playhead + 1);
      else if (id === 'start') current.seek(0);
      else if (id === 'end') current.seek(current.duration);
      else if (id === 'i') useStudio.setState({ inPoint: current.playhead });
      else if (id === 'o') useStudio.setState({ outPoint: current.playhead });
      else if (id === 's') useStudio.setState({ snapping: !current.snapping });
      else if (id === 'fit') {
        setTimelineZoom(null);
        useStudio.setState({ zoom: 1 });
      } else if (['v', 'b', 'y', 't'].includes(id))
        useStudio.setState({
          tool: ({ v: 'select', b: 'blade', y: 'slip', t: 'text' } as const)[
            id as 'v' | 'b' | 'y' | 't'
          ],
        });
      else if (id === 'escape') {
        if (document.querySelector('[role="listbox"]')) return false;
        composer.current?.blur();
        focusTimeline();
        return true;
      } else if (id === 'undo') {
        if (commands.undo) commands.undo();
        else void useEditing.getState().session?.undoUser();
      } else if (id === 'redo') {
        if (commands.redo) commands.redo();
        else void useEditing.getState().session?.redoUser();
      } else if (id === 'submit') {
        agentComposer.current?.submit();
      } else {
        setBoundary(
          id === 'submit'
            ? 'sending connects in Phase 8'
            : 'editing commands connect in Phase 7',
        );
      }
    },
    [commands, pauseAgent, fullscreen, project.fps, agentController],
  );
  React.useEffect(
    () => registerStudioKeyboard((id) => routeShortcut(id)),
    [routeShortcut],
  );
  const uploadFiles = async (files: readonly File[]) => {
    if (
      previewCutRef.current ||
      comparisonCutRef.current ||
      useEditing.getState().state?.persistenceStatus === 'locked'
    )
      throw new Error('this view is read-only');
    const life = uploadLife.current;
    if (!life || life.signal.aborted) return [];
    return attachSessionUploads({
      files,
      queue: useUploads,
      signal: life.signal,
      send: (attachments) => api.message(sessionId, '', attachments),
      refresh: () => api.session(sessionId),
      remember: (mapping) => {
        const draft = useSession.getState().draft;
        useSession.getState().save({
          sessionId,
          prompt: originalPrompt,
          wsUrl: snapshot.wsUrl ?? '',
          assetLocalMap: {
            ...(draft?.sessionId === sessionId ? draft.assetLocalMap : {}),
            ...mapping,
          },
        });
      },
      accepted: (restored) =>
        useEditing.getState().session?.replaceSnapshot(restored),
    });
  };
  const timelineMedia = React.useMemo(
    () =>
      state.previewStatus === 'ready'
        ? {
            getFilmstrip: async (
              clipId: string,
              width: number,
              signal?: AbortSignal,
            ) => {
              const handle = compositor.current?.getFilmstrip;
              if (!handle) throw new Error('filmstrip source is not ready');
              return handle(clipId, width, signal);
            },
            getWaveform: async (
              clipId: string,
              points: number,
              signal?: AbortSignal,
            ) => {
              const handle = compositor.current?.getWaveform;
              if (!handle) throw new Error('waveform source is not ready');
              return handle(clipId, points, signal);
            },
          }
        : null,
    [compositor, state.previewStatus, sessionId, assets],
  );
  const outputMeter = React.useMemo<LevelMeterAPI>(
    () =>
      state.previewStatus === 'ready'
        ? {
            available: true,
            measure: () => {
              const level = compositor.current?.getAudioLevel?.();
              if (!level?.available)
                throw new Error('output analyser is unavailable');
              return {
                channels: [level.peak],
                playing: level.state === 'measuring',
              };
            },
            subscribe: (listener) =>
              compositor.current?.subscribeAudioLevel?.(listener) ?? (() => {}),
          }
        : {
            available: false,
            reason:
              'audio output meter is not available until preview initializes',
          },
    [state.previewStatus, compositor],
  );
  const captionTrackId = React.useMemo(() => {
    if (!selectedTrackId) return undefined;
    const clips = Object.values(project.clips).filter(
      (clip) => clip.trackId === selectedTrackId,
    );
    return clips.length && clips.every(isCaptionClip)
      ? selectedTrackId
      : undefined;
  }, [selectedTrackId, project]);
  const editorSlots: StudioSlots = {
    ...slots,
    timelineActions: (
      <BeatToggle
        available={detectedBeats.length > 0}
        enabled={beatGridEnabled}
        onChange={setBeatGridEnabled}
        reason={
          detectedBeats.length
            ? undefined
            : 'beat detections were not supplied by the service.'
        }
      />
    ),
    timelineOwnsChrome: slots.timeline
      ? slots.timelineOwnsChrome
      : !!(editingState && editingSession),
    timeline:
      slots.timeline ??
      (editingState && editingSession ? (
        <TimelineEditor
          project={project}
          assets={assets}
          editing={editingSession}
          editState={editingState}
          beats={beatGridEnabled ? detectedBeats : undefined}
          selection={state.selection}
          setSelection={(selection) => {
            setSelectedTrackId(null);
            useStudio.setState({ selection });
          }}
          onSelectTrack={(trackId) => {
            setSelectedTrackId(trackId);
            useStudio.setState({ selection: [], inspectorCollapsed: false });
          }}
          InlineTextEditor={TimelineTextAdapter}
          playhead={state.playhead}
          onSeek={state.seek}
          onScrubStart={state.beginScrubbing}
          onScrub={state.updateScrubbing}
          onScrubEnd={() =>
            useStudio.getState().endScrubbing(useStudio.getState().playhead)
          }
          zoom={timelineZoom}
          onZoomChange={setTimelineZoom}
          tool={state.tool}
          snapping={state.snapping}
          linked={state.linked}
          onUpload={async (files) => {
            await uploadFiles(files);
          }}
          onReplace={(clipId) => setReplacement({ clipId, mode: 'all' })}
          onOpenText={setTextEditingId}
          onInspect={(id) =>
            useStudio.setState({ selection: [id], inspectorCollapsed: false })
          }
          onMessage={(text) => {
            useStudio.setState({ agentCollapsed: false });
            setAgentTab('chat');
            setWatchTab('chat');
            requestAnimationFrame(() => {
              agentComposer.current?.prefill(text);
              focusComposer();
            });
          }}
          mediaHandle={timelineMedia}
          onTogglePlayback={() => {
            const current = useStudio.getState();
            current.requestPlayback(!current.playing);
          }}
          onError={setBoundary}
          activeClipId={activeClipId}
          agentChange={agentChange}
          followKimo={state.followKimo}
        />
      ) : undefined),
    inspector:
      slots.inspector ??
      (editingState && editingSession ? (
        <InspectorEditor
          project={project}
          assets={rendererAssets}
          editing={editingSession}
          editState={editingState}
          selection={state.selection}
          playhead={state.playhead}
          onSeek={state.seek}
          onReplace={(clipId, mode) => setReplacement({ clipId, mode })}
          propertyActivity={propertyActivity}
          activeAction={
            state.activeAction
              ? {
                  id: state.activeAction.id,
                  clipId: state.activeAction.target?.clipId,
                  title: state.activeAction.title,
                }
              : null
          }
          captionTrackId={captionTrackId}
          lutAssets={builtinLutIds}
          onMaskOpen={(maskSectionOpen) =>
            useStudio.setState({ maskSectionOpen })
          }
          compare={{
            available: false,
            reason: 'before/after preview is not supported by this renderer',
          }}
          audioCapabilities={(clipId) =>
            compositor.current?.getAudioCapabilities?.(clipId) ?? {
              keepPitch: false,
              reason: 'preview audio path is not ready',
            }
          }
          levelMeter={outputMeter}
          onMessage={async (text) => {
            await agentController.send({ text });
          }}
        />
      ) : undefined),
  };
  const finish = () => {
    if (previewCutRef.current || comparisonCutRef.current) {
      setActivity('return to the current edit to render.');
      return;
    }
    if (commands.finish) {
      commands.finish();
      return;
    }
    if (approvalUnknown) {
      setBoundary(
        'render approval status is unknown; check again before making another request',
      );
      return;
    }
    setReviewMode(
      useStudio.getState().agent === 'acting' ? 'acting' : 'review',
    );
  };
  const reviewReady =
    !!editingState &&
    !editingState.draft &&
    editingState.pending.length === 0 &&
    editingState.saveStatus === 'saved';
  React.useEffect(() => {
    if (reviewMode === 'review') analytics.track('review_shown', {});
  }, [reviewMode]);
  const navigateToRender = (videoId?: string) => {
    const href = videoId
      ? `/v/${encodeURIComponent(videoId)}`
      : `/render/${encodeURIComponent(sessionId)}`;
    if (!videoId && reviewPoster.current)
      setRenderPoster(sessionId, reviewPoster.current.blob);
    setReviewMode('closed');
    deliveryTransition(
      () => router.push(href),
      typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
  };
  const approveReview = async (options: {
    burnInCaptions: boolean;
    expectedProjectVersion: number;
    title: string;
  }) => {
    if (
      previewCutRef.current ||
      comparisonCutRef.current ||
      restoreLock.current ||
      approvalLock.current ||
      approvalUnknown
    )
      return;
    const life = approvalLife.current;
    if (!life || life.signal.aborted) return;
    approvalLock.current = true;
    setApprovalPending(true);
    try {
      await Promise.resolve();
      const edit = useEditing.getState().session;
      if (!edit) throw new Error('the edit is not connected');
      await edit.flush();
      const current = edit.getState();
      if (
        current.draft ||
        current.pending.length ||
        current.saveStatus !== 'saved'
      )
        throw new Error(
          'finish the current edit and resolve unsaved changes before rendering',
        );
      if (current.acknowledgedVersion !== options.expectedProjectVersion)
        throw new Error(
          'the edit changed; review the current cut before rendering',
        );
      const outcome = await approveCut({
        client: {
          session: api.session,
          approve: async (id, input, options) => {
            const result = await api.approve(id, input, options);
            analytics.track('render_started', {});
            return result;
          },
        },
        sessionId,
        options: { ...options, preset: '1080p' },
        signal: life.signal,
      });
      if (life.signal.aborted || approvalLife.current !== life) return;
      if (outcome.kind === 'accepted') {
        navigateToRender(outcome.videoId);
        return;
      }
      setReviewMode('closed');
      if (outcome.kind === 'unknown')
        setApprovalUnknown({ baselineRenderId: outcome.baselineRenderId });
      setBoundary(outcome.message);
    } catch (error) {
      if (!life.signal.aborted) {
        setReviewMode('closed');
        setBoundary(
          error instanceof Error
            ? error.message
            : 'render approval status is unknown',
        );
      }
    } finally {
      if (approvalLife.current === life && !life.signal.aborted) {
        approvalLock.current = false;
        setApprovalPending(false);
      }
    }
  };
  const pauseForReview = async () => {
    if (approvalLock.current) return;
    approvalLock.current = true;
    setApprovalPending(true);
    const life = approvalLife.current;
    try {
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer);
          pauseObservers.current.delete(done);
          if (!life || life.signal.aborted)
            reject(new Error('review cancelled'));
          else resolve();
        };
        const timer = setTimeout(() => {
          pauseObservers.current.delete(done);
          reject(
            new Error(
              'pause acknowledgement was not received; no render approval was sent',
            ),
          );
        }, studioTiming.handshake);
        pauseObservers.current.add(done);
        try {
          agentController.pause();
        } catch (error) {
          clearTimeout(timer);
          pauseObservers.current.delete(done);
          reject(error);
        }
      });
      if (life && !life.signal.aborted) setReviewMode('review');
    } catch (error) {
      if (life && !life.signal.aborted) {
        setReviewMode('closed');
        setBoundary(
          error instanceof Error ? error.message : 'pause status unknown',
        );
      }
    } finally {
      if (life && !life.signal.aborted) {
        approvalLock.current = false;
        setApprovalPending(false);
      }
    }
  };
  React.useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get('review') === 'render' &&
      (snapshot.status === 'editing' || snapshot.status === 'awaiting_review')
    )
      setReviewMode('review');
  }, [sessionId, snapshot.status]);
  const activeGroup = conversation.items.find(
    (item) =>
      item.kind === 'action-group' &&
      !!state.activeAction &&
      item.actionIds.includes(state.activeAction.id),
  );
  const currentGroupSummary =
    activeGroup?.kind === 'action-group'
      ? activeGroup.stoppedAdjusting
        ? 'stopped here, adjusting'
        : (conversation.actions[activeGroup.actionIds[0] ?? '']?.title ?? null)
      : null;
  const latestReview = [...conversation.items]
    .reverse()
    .find((item) => item.kind === 'review');
  const clipNames = Object.fromEntries(
    Object.values(project.clips).map((clip) => [
      clip.id,
      clipLabel(clip, assets),
    ]),
  );
  const orangeOwner =
    state.agent === 'acting'
      ? ('running' as const)
      : state.reviewRequested
        ? ('review' as const)
        : ('none' as const);
  const sendConversation = (text: string) => {
    if (
      previewCutRef.current ||
      comparisonCutRef.current ||
      useEditing.getState().state?.persistenceStatus === 'locked'
    ) {
      setActivity('this view is read-only.');
      return;
    }
    setRecentPrompts(rememberPrompt(localStorageAdapter, text));
    void agentController
      .send({ text })
      .catch((error: unknown) =>
        setBoundary(
          error instanceof Error
            ? error.message
            : 'message dispatch status unknown',
        ),
      );
  };
  const presentation: AgentPresentationCallbacks = {
    onShow: (id) => {
      const target = conversation.actions[id]?.target;
      if (!target) {
        setActivity('this action has no recorded target');
        return;
      }
      const clip = target.clipId ? project.clips[target.clipId] : undefined;
      if (clip)
        useStudio.setState({ selection: [clip.id], inspectorCollapsed: false });
      if (target.time !== undefined || clip)
        useStudio.getState().seek(target.time ?? clip?.start ?? 0);
    },
    onRevert: (id) => {
      const edit = useEditing.getState().session;
      if (
        !edit
          ?.getState()
          .history.some(
            (entry) =>
              entry.actionId === id &&
              entry.author === 'agent' &&
              entry.available,
          )
      ) {
        setBoundary(
          'this step has no available local preimage; it cannot be safely reverted',
        );
        return;
      }
      void edit
        .revertAgentGroup(id)
        .then((result) => {
          if (result.status !== 'acknowledged')
            setActivity(result.error ?? `revert ${result.status}`);
        })
        .catch((error: unknown) =>
          setBoundary(
            error instanceof Error ? error.message : 'revert status unknown',
          ),
        );
    },
    onViewMask: (clipId) => {
      if (!project.clips[clipId]) {
        setActivity('this mask target is no longer in the edit');
        return;
      }
      useStudio.setState({
        selection: [clipId],
        inspectorCollapsed: false,
        maskSectionOpen: true,
        overlays: true,
      });
    },
    onPlayFromStart: () => {
      useStudio.getState().seek(0);
      useStudio.getState().requestPlayback(true);
    },
    onFocusComposer: () => {
      useStudio.setState({ agentCollapsed: false });
      setAgentTab('chat');
      setReviewComposer(true);
      requestAnimationFrame(focusComposer);
    },
    onRender: finish,
    onSend: sendConversation,
    onFeedback: (assetId, feedback) => {
      const asset =
        assets.find((asset) => asset.id === assetId) ??
        conversation.assets[assetId];
      if (asset)
        sendConversation(
          `${feedback === 'use' ? 'use this image' : 'not this image'}: ${asset.name} (${asset.id})`,
        );
    },
    onRetry: (id) => {
      const action = conversation.actions[id];
      if (action)
        sendConversation(
          `please retry the failed ${action.tool} step (${action.id})`,
        );
    },
  };
  const agentSlots: StudioSlots = {
    ...slots,
    agentOwnsScroll: slots.agentChat ? slots.agentOwnsScroll : true,
    agentChat: slots.agentChat ?? (
      <ChatStream
        {...presentation}
        model={conversation}
        assets={Object.fromEntries(assets.map((asset) => [asset.id, asset]))}
        clipNames={clipNames}
        orangeOwner={orangeOwner}
        active={!state.agentCollapsed && agentTab === 'chat'}
      />
    ),
    agentActions: slots.agentActions ?? (
      <ActionsTable
        model={conversation}
        clipNames={clipNames}
        orangeOwner={orangeOwner}
        active={!state.agentCollapsed && agentTab === 'actions'}
      />
    ),
    composer: slots.composer ?? (
      <>
        <AgentComposer
          key={sessionId}
          ref={agentComposer}
          clips={Object.values(project.clips).map((clip) => ({
            id: clip.id,
            name: clipLabel(clip, assets),
            thumbUrl: assets.find((asset) => asset.id === clip.assetId)
              ?.thumbUrl,
          }))}
          attachments={chatAttachments}
          placeholder={reviewComposer ? 'what should kimo change?' : undefined}
          working={state.agent === 'acting'}
          stopped={state.agent === 'paused'}
          orangeOwner={
            state.agent === 'acting' || state.reviewRequested
              ? 'other'
              : 'composer'
          }
          disabled={
            readonlyView || editingState?.persistenceStatus === 'locked'
          }
          parentHandlesModEnter={true}
          onEscape={focusTimeline}
          onSend={async (input) => {
            if (
              previewCutRef.current ||
              comparisonCutRef.current ||
              useEditing.getState().state?.persistenceStatus === 'locked'
            )
              throw new Error('this view is read-only');
            setRecentPrompts(rememberPrompt(localStorageAdapter, input.text));
            await agentController.send(input);
            setReviewComposer(false);
            setChatAttachments([]);
          }}
          onPause={() => dispatchAgent('pause')}
          onResume={() => dispatchAgent('resume')}
          onUndoLast={() => useEditing.getState().session?.undoUser()}
          onRender={finish}
          onStatus={setActivity}
          onRemoveAttachment={(id) =>
            setChatAttachments((current) =>
              current.filter((item) => item.id !== id),
            )
          }
          onUpload={async (files) => {
            const life = uploadLife.current;
            const batch = files.map((file) => ({
              id: crypto.randomUUID(),
              name: file.name,
              status: 'uploading' as const,
            }));
            setChatAttachments((current) => [...current, ...batch]);
            try {
              const ids = await uploadFiles(files);
              if (!life || life.signal.aborted || uploadLife.current !== life)
                return;
              const actual =
                useEditing.getState().session?.getState().assets ??
                assetsRef.current;
              setChatAttachments((current) =>
                current.map((item) => {
                  const index = batch.findIndex(
                    (pending) => pending.id === item.id,
                  );
                  if (index < 0) return item;
                  const asset = actual.find((asset) => asset.id === ids[index]);
                  return asset
                    ? { ...item, asset, status: 'ready' }
                    : { ...item, status: 'failed' };
                }),
              );
            } catch (error) {
              if (!life || life.signal.aborted || uploadLife.current !== life)
                return;
              setChatAttachments((current) =>
                current.map((item) =>
                  batch.some((pending) => pending.id === item.id)
                    ? { ...item, status: 'failed' }
                    : item,
                ),
              );
              setActivity(
                error instanceof Error
                  ? error.message
                  : 'attachment confirmation failed',
              );
            }
          }}
        />
        {notifications ? (
          <NotificationPrompt controller={notifications} />
        ) : null}
      </>
    ),
  };
  const announcement = [...conversation.items]
    .reverse()
    .find((item) => item.kind === 'say' && (!item.stream || item.stream.done));
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
      data-project-save={editingState?.saveStatus}
      data-timeline-zoom={timelineZoom ?? 'fit'}
      data-text-editing={textEditingId ?? undefined}
      data-watch-tab={watchTab}
      data-agent-collapsed={state.agentCollapsed || undefined}
      data-inspector-collapsed={state.inspectorCollapsed || undefined}
      data-testid="studio-shell"
      aria-label="video studio"
    >
      <StudioTopBar
        projectTitle={projectTitle}
        onTitleChange={setProjectTitle}
        readOnly={readonlyView}
        projectActions={
          <CutsMenu
            cuts={cuts}
            selectedId={previewCut?.id ?? null}
            onExit={() => setPreviewCut(null)}
            onSelect={(id) => {
              const cut = cuts.find((item) => item.id === id);
              if (!cut) return;
              if (slots.viewer) {
                setActivity(
                  'historical preview is unavailable for this custom viewer.',
                );
                return;
              }
              useStudio.getState().requestPlayback(false);
              setTextEditingId(null);
              setComparisonCut(null);
              setRestoreReview(null);
              setPreviewCut(cut);
              useStudio.getState().seek(0);
            }}
          />
        }
        projectSave={editingState?.saveStatus}
        sessionId={sessionId}
        commands={{
          ...commands,
          pauseAgent: readonlyView
            ? () => setActivity('this view is read-only.')
            : (commands.pauseAgent ?? pauseAgent),
          fullscreen,
          undo: readonlyView
            ? undefined
            : (commands.undo ??
              (editingState?.canUndo
                ? () => {
                    void editingSession?.undoUser();
                  }
                : undefined)),
          redo: readonlyView
            ? undefined
            : (commands.redo ??
              (editingState?.canRedo
                ? () => {
                    void editingSession?.redoUser();
                  }
                : undefined)),
          finish,
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
      {previewCut && (
        <CutPreviewBanner
          cut={previewCut}
          onExit={() => setPreviewCut(null)}
          restoreDisabledReason={
            !restorePlan?.available
              ? (restorePlan?.reasons
                  .map((reason) => reason.message)
                  .join('; ') ?? 'live editing is not ready')
              : restorePending
                ? 'restore is pending'
                : undefined
          }
          onRestore={() => {
            const editor = useEditing.getState().session;
            if (!editor || restoreLock.current) return;
            const current = editor.getState();
            const plan = planCutRestore(
              { sessionId, ...current },
              previewCut,
              current.assets,
            );
            if (!plan.available) {
              setBoundary(
                plan.reasons.map((reason) => reason.message).join('; '),
              );
              return;
            }
            if (plan.noop) {
              setActivity(
                'this cut already matches the current edit. no changes were sent.',
              );
              return;
            }
            setRestoreReview({ cut: previewCut, plan });
          }}
        />
      )}
      {comparisonCut && (
        <section
          className="studio-storage-notice"
          aria-label="read-only comparison"
        >
          comparing current edit with {comparisonCut.label} · read-only ·
          current edit audio only
          <span role="status">
            {comparisonStatus?.reason ??
              (comparisonStatus?.phase === 'ready'
                ? 'both cut frames ready'
                : 'preparing both cut frames')}
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              setComparisonCut(null);
              setComparisonStatus(null);
            }}
          >
            exit comparison
          </Button>
        </section>
      )}
      <Dialog
        open={!!restoreReview}
        onOpenChange={(open) => {
          if (!open && !restoreLock.current) setRestoreReview(null);
        }}
      >
        <DialogContent>
          <DialogTitle>restore {restoreReview?.cut.label}</DialogTitle>
          <DialogDescription>
            replace the current edit with this device-local cut using existing
            edit operations. the reviewed version must still match. accepted
            changes can be undone only while their exact guarded state still
            matches.
          </DialogDescription>
          <DialogActions>
            <Button
              variant="ghost"
              disabled={restorePending}
              onClick={() => setRestoreReview(null)}
            >
              cancel
            </Button>
            <Button
              disabled={restorePending}
              onClick={async () => {
                if (!restoreReview || restoreLock.current) return;
                const editor = useEditing.getState().session;
                if (!editor) return;
                restoreLock.current = true;
                setRestorePending(true);
                const reviewed = restoreReview;
                try {
                  const result = await editor.editGroup(
                    reviewed.plan.ops,
                    `restore ${reviewed.cut.label}`,
                    'history',
                    reviewed.plan.options,
                  );
                  setRestoreReview(null);
                  if (result.status === 'acknowledged') {
                    setPreviewCut(null);
                    setActivity(
                      `${reviewed.cut.label} restored and acknowledged.`,
                    );
                  } else
                    setBoundary(
                      result.status === 'unknown'
                        ? 'restore acceptance is unknown. do not repeat it; reconcile the current edit first.'
                        : (result.error ??
                            `restore ${result.status}. the saved edit has not been confirmed.`),
                    );
                } catch {
                  setRestoreReview(null);
                  setBoundary(
                    'restore did not return a confirmed result. reconcile the current edit before trying again.',
                  );
                } finally {
                  restoreLock.current = false;
                  setRestorePending(false);
                }
              }}
            >
              restore this cut
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
      {editingState && editingState.persistenceStatus !== 'ready' && (
        <div className="studio-storage-notice" role="status">
          {editingState.persistenceStatus === 'hydrating'
            ? 'restoring saved edits…'
            : editingState.persistenceStatus === 'locked'
              ? 'another tab owns this edit. this tab is read-only.'
              : 'local edit storage is unavailable. changes remain unsaved in this tab and will not be sent.'}
        </div>
      )}
      <div className="studio-workspace" data-testid="studio-workspace">
        <div className="studio-upper">
          <AgentPanel
            prompt={originalPrompt}
            slots={agentSlots}
            composerRef={composer}
            onStop={() => safeAgentIntent('stop')}
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
              reviewOverlay: (
                <>
                  <ReviewPrompt
                    requestId={previewCut ? null : (latestReview?.id ?? null)}
                    onWatch={presentation.onPlayFromStart}
                  />
                </>
              ),
              viewerActions: cuts.length ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="xs">
                      compare cuts
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent aria-label="cut comparison controls">
                    <label>
                      compare current edit with
                      <select
                        aria-label="comparison cut"
                        value={comparisonCut?.id ?? ''}
                        onChange={(event) => {
                          const cut = cuts.find(
                            (item) => item.id === event.target.value,
                          );
                          if (!cut) return;
                          useStudio.getState().requestPlayback(false);
                          setPreviewCut(null);
                          setRestoreReview(null);
                          setTextEditingId(null);
                          setComparisonCut(cut);
                        }}
                        disabled={
                          !!slots.viewer ||
                          state.previewStatus !== 'ready' ||
                          !compositor.current?.getCutComparisonCapability?.()
                            .available
                        }
                      >
                        <option value="">choose a cut</option>
                        {cuts.map((cut) => (
                          <option key={cut.id} value={cut.id}>
                            {cut.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <CompareControl
                      cutLabel={comparisonCut?.label ?? cuts[0]?.label ?? 'cut'}
                      capability={
                        slots.viewer
                          ? {
                              available: false,
                              reason:
                                'comparison is unavailable for this custom viewer.',
                            }
                          : (compositor.current?.getCutComparisonCapability?.() ?? {
                              available: false,
                              reason: 'comparison requires a ready renderer.',
                            })
                      }
                      value={comparisonSplit * 100}
                      onChange={(value) => setComparisonSplit(value / 100)}
                      active={!!comparisonCut}
                      onExit={() => {
                        setComparisonCut(null);
                        setComparisonStatus(null);
                      }}
                      status={
                        comparisonStatus?.reason ??
                        (comparisonStatus?.phase === 'preparing'
                          ? 'preparing both cut frames'
                          : comparisonStatus?.approximations.join('; '))
                      }
                      onEnable={() => {
                        useStudio.getState().requestPlayback(false);
                        setTextEditingId(null);
                        setPreviewCut(null);
                        if (cuts[0]) setComparisonCut(cuts[0]);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              ) : (
                slots.viewerActions
              ),
              viewer:
                slots.viewer ??
                (Object.keys(project.clips).length ||
                comparisonCut ||
                cuts.length ? (
                  <StudioCompositor
                    key={sessionId}
                    project={project}
                    assets={rendererAssets}
                    bridgeRef={compositor}
                    historical={!!previewCut}
                    comparison={comparisonInput}
                    onComparisonChange={setComparisonStatus}
                    editing={readonlyView ? null : editingSession}
                    onOpenText={readonlyView ? undefined : setTextEditingId}
                    activeTextId={textEditingId}
                    onTextFinish={() => setTextEditingId(null)}
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
              <InspectorPanel
                project={project}
                assets={assets}
                slots={editorSlots}
              />
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
          slots={editorSlots}
          zoom={timelineZoom}
          onZoomChange={setTimelineZoom}
          toggle={() => togglePanel('timeline')}
        />
      </div>
      <ActingRenderDialog
        open={reviewMode === 'acting'}
        currentGroupSummary={currentGroupSummary}
        pending={approvalPending}
        ready={reviewReady}
        onOpenChange={(open) => {
          if (!open && !approvalPending) setReviewMode('closed');
        }}
        onRenderNow={() => {
          void pauseForReview();
        }}
        onLetFinish={() => setReviewMode('closed')}
      />
      <ReviewDialog
        open={reviewMode === 'review'}
        project={project}
        title={projectTitle}
        ready={reviewReady && !approvalUnknown}
        pending={approvalPending}
        getFrame={captureReviewFrame}
        onPoster={recordReviewPoster}
        onOpenChange={(open) => {
          if (!open && !approvalPending) setReviewMode('closed');
        }}
        onKeepEditing={() => setReviewMode('closed')}
        onRender={(options) => {
          void approveReview(options);
        }}
      />
      <ReplaceMediaDialog
        clipId={replacement?.clipId ?? null}
        mode={replacement?.mode ?? 'all'}
        project={project}
        assets={assets}
        editing={editingSession}
        onClose={() => setReplacement(null)}
        onUpload={uploadFiles}
      />
      <LiveAnnouncer
        key={sessionId}
        action={
          state.activeAction
            ? { id: state.activeAction.id, label: state.activeAction.title }
            : null
        }
        message={
          announcement?.kind === 'say'
            ? { id: announcement.id, text: announcement.text }
            : undefined
        }
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={[
          {
            id: 'add-text',
            label: 'add text',
            disabledReason: readonlyView ? 'this view is read-only' : undefined,
            run: () => {
              routeShortcut('add-text', true);
            },
          },
          {
            id: 'split',
            label: 'split',
            disabledReason: readonlyView ? 'this view is read-only' : undefined,
            run: () => {
              routeShortcut('split', true);
            },
          },
          {
            id: 'render',
            label: 'render',
            disabledReason: previewCut
              ? 'return to the current edit to render'
              : undefined,
            run: finish,
          },
          {
            id: 'captions',
            label: 'toggle captions',
            disabledReason: readonlyView ? 'this view is read-only' : undefined,
            run: () => {
              const edit = useEditing.getState().session;
              if (!edit) return;
              const current = edit.getState().project;
              const trackIds = new Set(
                Object.values(current.clips)
                  .filter(isCaptionClip)
                  .map((clip) => clip.trackId),
              );
              const tracks = current.tracks.filter((track) =>
                trackIds.has(track.id),
              );
              if (!tracks.length) {
                setActivity('no caption track is available.');
                return;
              }
              const hidden = !tracks.every((track) => track.hidden);
              void edit.editGroup(
                tracks.map((track) => ({
                  op: 'track.update' as const,
                  id: track.id,
                  patch: { hidden },
                })),
                'toggle captions',
                'keyboard',
              );
            },
          },
        ]}
        clips={Object.values(project.clips).map((clip) => ({
          id: clip.id,
          name: clipLabel(clip, assets),
        }))}
        recentPrompts={recentPrompts}
        onSelectClip={(id) => {
          const clip = project.clips[id];
          if (clip) {
            useStudio.setState({ selection: [id] });
            useStudio.getState().seek(clip.start);
          }
        }}
        onPrompt={(text) => {
          agentComposer.current?.prefill(text);
          focusComposer();
        }}
      />
      {!paletteOpen &&
        !help &&
        !boundary &&
        reviewMode === 'closed' &&
        cutsStore.current && (
          <ShortcutsCoachmarks
            storage={localStorageAdapter}
            anchors={coachAnchors}
            onPrepareAnchor={prepareCoachAnchor}
          />
        )}
      <StudioStatusBar activity={activity} />
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
            {approvalUnknown ? (
              <Button
                variant="secondary"
                disabled={approvalPending}
                onClick={() => {
                  if (approvalLock.current) return;
                  const life = approvalLife.current;
                  if (!life || life.signal.aborted) return;
                  approvalLock.current = true;
                  setApprovalPending(true);
                  void reconcileApproval(
                    api,
                    sessionId,
                    approvalUnknown.baselineRenderId,
                  )
                    .then((outcome) => {
                      if (life.signal.aborted || approvalLife.current !== life)
                        return;
                      if (outcome.kind === 'accepted') {
                        setApprovalUnknown(null);
                        setBoundary('');
                        navigateToRender(outcome.videoId);
                      } else setBoundary(outcome.message);
                    })
                    .finally(() => {
                      if (
                        !life.signal.aborted &&
                        approvalLife.current === life
                      ) {
                        approvalLock.current = false;
                        setApprovalPending(false);
                      }
                    });
                }}
              >
                check render status
              </Button>
            ) : null}
            <Button onClick={() => setBoundary('')}>close</Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </main>
  );
}
