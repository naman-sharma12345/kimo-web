import {
  ApiError,
  type KimoClient,
  type Render,
  type SessionSnapshot,
} from '@kimo/client';

export type RenderApi = Pick<
  KimoClient,
  'session' | 'render' | 'renderFrameUrl' | 'cancelRender' | 'reopenSession'
>;
export const renderTiming = {
  poll: 800,
  completion: 1400,
  reducedCompletion: 220,
} as const;
export function renderStage(progress: number): string {
  return progress < 0.85
    ? 'composing frames'
    : progress < 0.95
      ? 'mixing audio'
      : progress < 0.99
        ? 'encoding 1080p'
        : 'finishing up';
}
export function renderedChunk(render: Render): number | undefined {
  return (
    render.chunkIndex ??
    (render.fps ? Math.floor(render.frame / render.fps) : undefined)
  );
}
export function terminal(render: Render): boolean {
  return (
    render.status === 'done' ||
    render.status === 'failed' ||
    render.status === 'cancelled'
  );
}
export type RouteFailure = 'missing' | 'expired' | 'unavailable';
export function routeFailure(error: unknown): RouteFailure {
  return error instanceof ApiError && error.status === 404
    ? 'missing'
    : error instanceof ApiError && error.status === 410
      ? 'expired'
      : 'unavailable';
}
/** Recursive scheduling, including failures. A stopped generation can never publish or schedule. */
export function pollRender(
  api: Pick<RenderApi, 'render'>,
  id: string,
  observe: (render: Render) => void,
  unavailable: (error: unknown) => void,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const tick = async () => {
    try {
      const value = await api.render(id, { signal: controller.signal });
      if (stopped) return;
      observe(value);
      if (terminal(value)) return;
    } catch (error) {
      if (stopped) return;
      unavailable(error);
    }
    if (!stopped) timer = setTimeout(() => void tick(), renderTiming.poll);
  };
  void tick();
  return () => {
    stopped = true;
    controller.abort();
    clearTimeout(timer);
  };
}
export type EditingOutcome =
  { kind: 'editing' } | { kind: 'done'; videoId: string } | { kind: 'unknown' };
/** A transport failure is an unknown write. Reconcile by GET only, never repeat the POST. */
export async function cancelToEditing(
  api: RenderApi,
  sessionId: string,
  renderId: string,
  signal?: AbortSignal,
): Promise<EditingOutcome> {
  try {
    await api.cancelRender(renderId, { signal });
  } catch {
    /* read authority below, including done races */
  }
  try {
    const snapshot = await api.session(sessionId, { signal });
    if (snapshot.status === 'editing') return { kind: 'editing' };
    if (snapshot.status === 'done' && snapshot.videoId)
      return { kind: 'done', videoId: snapshot.videoId };
  } catch {
    /* unknown is not a failed render */
  }
  return { kind: 'unknown' };
}
export async function reopenEditing(
  api: RenderApi,
  sessionId: string,
  signal?: AbortSignal,
): Promise<EditingOutcome> {
  try {
    const result = await api.reopenSession(sessionId, { signal });
    if (result.status === 'editing') return { kind: 'editing' };
  } catch (error) {
    // Explicit rejections retain their actual expiry/authorization boundary.
    if (error instanceof ApiError && error.status < 500) throw error;
    try {
      if ((await api.session(sessionId, { signal })).status === 'editing')
        return { kind: 'editing' };
    } catch {
      /* unresolved */
    }
  }
  return { kind: 'unknown' };
}
export function resolveSession(
  snapshot: SessionSnapshot,
):
  | { kind: 'job'; renderId: string }
  | { kind: 'video'; videoId: string }
  | { kind: 'unresolved' } {
  if (snapshot.status === 'done' && snapshot.videoId)
    return { kind: 'video', videoId: snapshot.videoId };
  if (snapshot.renderId) return { kind: 'job', renderId: snapshot.renderId };
  return { kind: 'unresolved' };
}
