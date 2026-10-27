import {
  ApiError,
  type ApprovalOptions,
  type SessionSnapshot,
} from '@kimo/client';
export interface ApprovalClient {
  session(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<SessionSnapshot>;
  approve(
    id: string,
    input?: ApprovalOptions,
    options?: { signal?: AbortSignal },
  ): Promise<{ renderId: string }>;
}
export type ApprovalOutcome =
  | { kind: 'accepted'; renderId: string; videoId?: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'unknown'; message: string; baselineRenderId?: string };
/** Read-only reconciliation never repeats a possibly accepted POST. */
export async function reconcileApproval(
  client: ApprovalClient,
  sessionId: string,
  baselineRenderId?: string,
): Promise<ApprovalOutcome> {
  try {
    const snapshot = await client.session(sessionId);
    if (
      snapshot.renderId &&
      snapshot.renderId !== baselineRenderId &&
      ['rendering', 'done', 'failed'].includes(snapshot.status)
    )
      return {
        kind: 'accepted',
        renderId: snapshot.renderId,
        ...(snapshot.videoId ? { videoId: snapshot.videoId } : {}),
      };
  } catch {
    /* A failed read cannot establish rejection. */
  }
  return {
    kind: 'unknown',
    baselineRenderId,
    message:
      'render approval status is unknown; check again before making another request',
  };
}
/** One preflight and at most one approval dispatch, with no automatic write retries. */
export async function approveCut(input: {
  client: ApprovalClient;
  sessionId: string;
  options: ApprovalOptions & { expectedProjectVersion: number };
  signal?: AbortSignal;
}): Promise<ApprovalOutcome> {
  let before: SessionSnapshot;
  try {
    before = await input.client.session(input.sessionId, {
      signal: input.signal,
    });
  } catch (error) {
    return {
      kind: 'rejected',
      message:
        error instanceof Error
          ? error.message
          : 'could not verify the current edit',
    };
  }
  if (input.signal?.aborted)
    return { kind: 'rejected', message: 'render approval was not dispatched' };
  if (before.project.version !== input.options.expectedProjectVersion)
    return {
      kind: 'rejected',
      message: 'the edit changed; review the current cut before rendering',
    };
  if (before.status === 'rendering' && before.renderId)
    return { kind: 'accepted', renderId: before.renderId };
  try {
    const result = await input.client.approve(input.sessionId, input.options, {
      signal: input.signal,
    });
    return { kind: 'accepted', renderId: result.renderId };
  } catch (error) {
    // These explicit client rejections are known nonacceptance. Network/5xx/schema
    // failures may have followed an accepted job and are never retried here.
    if (
      error instanceof ApiError &&
      [400, 401, 403, 404, 409, 410, 422].includes(error.status)
    )
      return { kind: 'rejected', message: error.message };
    return reconcileApproval(input.client, input.sessionId, before.renderId);
  }
}
