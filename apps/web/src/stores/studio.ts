import { create } from 'zustand';
import type { ServerEvent } from '@kimo/client';
export type AgentState =
  'thinking' | 'acting' | 'waiting_user' | 'idle' | 'paused';
export type StudioTool = 'select' | 'blade' | 'slip' | 'text';
export type PanelName = 'agent' | 'inspector' | 'timeline';
export interface PanelSizes {
  agent: number;
  inspector: number;
  timeline: number;
}
export const defaultSizes: PanelSizes = {
  agent: 360,
  inspector: 320,
  timeline: 320,
};
export function responsiveSizes(width: number): PanelSizes {
  return width >= 1600
    ? defaultSizes
    : width >= 1280
      ? { agent: 320, inspector: 280, timeline: 280 }
      : { agent: 300, inspector: 320, timeline: 280 };
}
export function clampPanel(
  panel: PanelName,
  value: number,
  height: number,
): number {
  const bounds = {
    agent: [300, 480],
    inspector: [280, 420],
    timeline: [200, Math.max(200, height * 0.6)],
  };
  const [min, max] = bounds[panel];
  return Math.min(
    max ?? value,
    Math.max(
      min ?? value,
      Number.isFinite(value) ? value : defaultSizes[panel],
    ),
  );
}
export interface StudioPreferences {
  sizes: Partial<PanelSizes>;
  agentCollapsed: boolean;
  inspectorCollapsed: boolean;
  timelineCollapsed: boolean;
}
const defaults = (): StudioPreferences => ({
  sizes: {},
  agentCollapsed: false,
  inspectorCollapsed: false,
  timelineCollapsed: false,
});
export function readPreferences(userKey: string): StudioPreferences {
  try {
    const raw: unknown = JSON.parse(
      localStorage.getItem(`kimo-studio:v1:${userKey}`) ?? 'null',
    );
    if (!raw || typeof raw !== 'object') return defaults();
    const record = raw as Record<string, unknown>;
    const sizes: Partial<PanelSizes> = {};
    if (record.sizes && typeof record.sizes === 'object') {
      for (const panel of ['agent', 'inspector', 'timeline'] as const) {
        const value: unknown = (record.sizes as Record<string, unknown>)[panel];
        if (typeof value === 'number' && Number.isFinite(value))
          sizes[panel] = value;
      }
    }
    return {
      sizes,
      agentCollapsed: record.agentCollapsed === true,
      inspectorCollapsed: record.inspectorCollapsed === true,
      timelineCollapsed: record.timelineCollapsed === true,
    };
  } catch {
    return defaults();
  }
}
export type PreviewStatus =
  'legacy' | 'initializing' | 'ready' | 'unavailable' | 'error';
export function canPlayPreview(status: PreviewStatus): boolean {
  return status === 'legacy' || status === 'ready';
}
export interface StudioState extends StudioPreferences {
  previewStatus: PreviewStatus;
  setPreviewStatus: (status: PreviewStatus) => void;
  requestPlayback: (playing: boolean, shuttle?: number) => void;
  sessionId: string;
  agent: AgentState;
  agentLabel: string;
  activeAction: Extract<ServerEvent, { t: 'agent.action.start' }> | null;
  actionIds: string[];
  reviewRequested: boolean;
  hasOps: boolean;
  connection: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  wsVersion: number | null;
  latencyMs: number | null;
  previewFps: number | null;
  viewerZoom: 'fit' | '50%' | '100%';
  guides: boolean;
  overlays: boolean;
  fullscreen: boolean;
  maskSectionOpen: boolean;
  scrubbing: boolean;
  scrubAudioEnabled: boolean;
  seekRevision: number;
  beginScrubbing: () => void;
  updateScrubbing: (seconds: number) => void;
  endScrubbing: (seconds: number) => void;
  publishPlayback: (
    seconds: number,
    playing: boolean,
    fps: number | null,
  ) => void;
  playing: boolean;
  playhead: number;
  duration: number;
  loop: boolean;
  volume: number;
  speed: number;
  shuttle: number;
  inPoint: number | null;
  outPoint: number | null;
  tool: StudioTool;
  snapping: boolean;
  linked: boolean;
  zoom: number;
  followKimo: boolean;
  selection: string[];
  unread: boolean;
  resetSession: (
    id: string,
    duration: number,
    hasOps: boolean,
    review: boolean,
  ) => void;
  receive: (event: ServerEvent) => void;
  togglePanel: (panel: PanelName) => void;
  seek: (seconds: number) => void;
  persist: (userKey: string) => void;
}
export const useStudio = create<StudioState>((set, get) => ({
  ...defaults(),
  previewStatus: 'legacy',
  setPreviewStatus: (previewStatus) =>
    set({
      previewStatus,
      ...(!canPlayPreview(previewStatus)
        ? { playing: false, shuttle: 0, previewFps: null }
        : {}),
    }),
  requestPlayback: (playing, shuttle = 0) =>
    set({
      playing: playing && canPlayPreview(get().previewStatus),
      shuttle: canPlayPreview(get().previewStatus) ? shuttle : 0,
    }),
  sessionId: '',
  agent: 'idle',
  agentLabel: '',
  activeAction: null,
  actionIds: [],
  reviewRequested: false,
  hasOps: false,
  connection: 'disconnected',
  wsVersion: null,
  latencyMs: null,
  previewFps: null,
  viewerZoom: 'fit',
  guides: false,
  overlays: true,
  fullscreen: false,
  maskSectionOpen: false,
  scrubbing: false,
  scrubAudioEnabled: true,
  seekRevision: 0,
  beginScrubbing: () =>
    set({
      scrubbing: true,
      playing: false,
      seekRevision: get().seekRevision + 1,
    }),
  updateScrubbing: (seconds) =>
    set({
      playhead: Number.isFinite(seconds)
        ? Math.max(0, Math.min(get().duration, seconds))
        : get().playhead,
      seekRevision: get().seekRevision + 1,
    }),
  endScrubbing: (seconds) =>
    set({
      scrubbing: false,
      playhead: Number.isFinite(seconds)
        ? Math.max(0, Math.min(get().duration, seconds))
        : get().playhead,
      seekRevision: get().seekRevision + 1,
    }),
  publishPlayback: (playhead, playing, previewFps) =>
    set(
      canPlayPreview(get().previewStatus)
        ? { playhead, playing, previewFps }
        : { playing: false, previewFps: null },
    ),
  playing: false,
  playhead: 0,
  duration: 0,
  loop: false,
  volume: 1,
  speed: 1,
  shuttle: 0,
  inPoint: null,
  outPoint: null,
  tool: 'select',
  snapping: true,
  linked: true,
  zoom: 1,
  followKimo: true,
  selection: [],
  unread: false,
  resetSession: (sessionId, duration, hasOps, reviewRequested) =>
    set({
      sessionId,
      previewStatus: 'legacy',
      shuttle: 0,
      duration,
      hasOps,
      reviewRequested,
      agent: reviewRequested ? 'waiting_user' : 'idle',
      agentLabel: '',
      activeAction: null,
      actionIds: [],
      playing: false,
      scrubbing: false,
      fullscreen: false,
      maskSectionOpen: false,
      seekRevision: 0,
      playhead: 0,
      connection: 'disconnected',
      wsVersion: null,
      latencyMs: null,
      previewFps: null,
      selection: [],
      unread: false,
      inPoint: null,
      outPoint: null,
    }),
  receive: (event) => {
    if (event.t === 'hello') set({ wsVersion: event.version });
    if (event.t === 'agent.status')
      set({ agent: event.state, agentLabel: event.label });
    if (event.t === 'agent.action.start' && !get().actionIds.includes(event.id))
      set((state) => ({
        agent: 'acting',
        activeAction: event,
        agentLabel: event.title,
        unread: state.agentCollapsed,
        actionIds: state.actionIds.includes(event.id)
          ? state.actionIds
          : [...state.actionIds, event.id],
      }));
    if (event.t === 'agent.action.end' && get().activeAction?.id === event.id)
      set({ activeAction: null, agentLabel: '', agent: 'thinking' });
    if (event.t === 'project.ops') set({ hasOps: true });
    if (
      event.t === 'agent.message' &&
      (event.kind === 'ask_review' || event.kind === 'ask_choice')
    )
      set({
        reviewRequested: event.kind === 'ask_review',
        agent: 'waiting_user',
        unread: get().agentCollapsed,
      });
  },
  togglePanel: (panel) => {
    if (panel === 'agent')
      set((s) => ({ agentCollapsed: !s.agentCollapsed, unread: false }));
    if (panel === 'inspector')
      set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed }));
    if (panel === 'timeline')
      set((s) => ({ timelineCollapsed: !s.timelineCollapsed }));
  },
  seek: (seconds) =>
    set({
      playhead: Number.isFinite(seconds)
        ? Math.max(0, Math.min(get().duration, seconds))
        : get().playhead,
      seekRevision: get().seekRevision + 1,
    }),
  persist: (key) => {
    const { sizes, agentCollapsed, inspectorCollapsed, timelineCollapsed } =
      get();
    try {
      localStorage.setItem(
        `kimo-studio:v1:${key}`,
        JSON.stringify({
          sizes,
          agentCollapsed,
          inspectorCollapsed,
          timelineCollapsed,
        }),
      );
    } catch {
      /* Layout remains usable when storage is restricted. */
    }
  },
}));
