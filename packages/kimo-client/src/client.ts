import { z } from 'zod';
import * as s from './schema';
import { applyOps } from './ops';
import { parseApiBase, resolveSessionWsUrl } from './config';
export interface KimoClientOptions {
  credentials?: RequestCredentials;
  wsOrigin?: string;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export class KimoClient {
  constructor(
    public readonly base: string,
    private request: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly options: KimoClientOptions = {},
  ) {
    this.base = parseApiBase(base);
  }
  private async json<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.request(this.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: this.options.credentials ?? 'include',
      redirect: 'error',
      ...(signal ? { signal } : {}),
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new ApiError(response.status, await response.text());
    return schema.parse(await response.json());
  }
  uploads(files: z.infer<typeof s.uploadRequestSchema>['files']) {
    return this.json(
      '/v1/uploads',
      s.uploadResponseSchema,
      s.uploadRequestSchema.parse({ files }),
    );
  }
  completeUpload(
    assetId: string,
    parts: z.infer<typeof s.completeRequestSchema>['parts'],
  ) {
    return this.json(
      `/v1/uploads/${encodeURIComponent(assetId)}/complete`,
      z.object({ ok: z.literal(true) }),
      s.completeRequestSchema.parse({ parts }),
    );
  }
  createSession(body: s.SessionRequest) {
    return this.json(
      '/v1/sessions',
      s.sessionResponseSchema,
      s.sessionRequestSchema.parse(body),
    );
  }
  session(id: string, options?: { signal?: AbortSignal }) {
    return this.json(
      `/v1/sessions/${encodeURIComponent(id)}`,
      s.sessionSnapshotSchema,
      undefined,
      options?.signal,
    );
  }
  async message(id: string, text: string, attachments?: string[]) {
    const response = await this.request(
      `${this.base}/v1/sessions/${encodeURIComponent(id)}/messages`,
      {
        method: 'POST',
        credentials: this.options.credentials ?? 'include',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          s.messageRequestSchema.parse({ text, attachments }),
        ),
      },
    );
    if (response.status !== 202)
      throw new ApiError(response.status, await response.text());
  }
  ops(
    id: string,
    ops: s.Op[],
    baseVersion: number,
    options?: { signal?: AbortSignal; clientMutationId?: string },
  ) {
    return this.json(
      `/v1/sessions/${encodeURIComponent(id)}/ops`,
      s.versionResponseSchema,
      s.opsRequestSchema.parse({
        ops,
        baseVersion,
        ...(options?.clientMutationId
          ? { clientMutationId: options.clientMutationId }
          : {}),
      }),
      options?.signal,
    );
  }
  approve(
    id: string,
    input?: s.ApprovalOptions,
    options?: { signal?: AbortSignal },
  ) {
    return this.json(
      `/v1/sessions/${encodeURIComponent(id)}/approve`,
      s.approvalResponseSchema,
      s.approvalOptionsSchema.parse(input ?? {}),
      options?.signal,
    );
  }
  render(id: string, options?: { signal?: AbortSignal }) {
    return this.json(
      `/v1/renders/${encodeURIComponent(id)}`,
      s.renderSchema,
      undefined,
      options?.signal,
    );
  }
  video(id: string, options?: { signal?: AbortSignal }) {
    return this.json(
      `/v1/videos/${encodeURIComponent(id)}`,
      s.videoSchema,
      undefined,
      options?.signal,
    );
  }
  renderFrameUrl(id: string, frame: number): string {
    z.number().int().nonnegative().safe().parse(frame);
    return `${this.base}/v1/renders/${encodeURIComponent(id)}/frame.jpg?n=${frame}`;
  }
  cancelRender(id: string, options?: { signal?: AbortSignal }) {
    return this.json(
      `/v1/renders/${encodeURIComponent(id)}/cancel`,
      s.cancelRenderResponseSchema,
      {},
      options?.signal,
    );
  }
  reopenSession(id: string, options?: { signal?: AbortSignal }) {
    return this.json(
      `/v1/sessions/${encodeURIComponent(id)}/reopen`,
      s.reopenSessionResponseSchema,
      {},
      options?.signal,
    );
  }
  /** Duplicate packets are ignored; a missing batch replaces state from the server. */
  async reconcile(
    id: string,
    project: s.KimoProject,
    event: s.ServerEvent,
  ): Promise<s.KimoProject> {
    if (event.t !== 'project.ops' || event.version <= project.version)
      return project;
    if (event.version !== project.version + 1)
      return (await this.session(id)).project;
    return applyOps(project, event.ops, event.version);
  }
  /** The caller may display applyOps(project,ops) optimistically. Retry once on conflict. */
  async edit(
    id: string,
    project: s.KimoProject,
    ops: s.Op[],
  ): Promise<s.KimoProject> {
    try {
      const result = await this.ops(id, ops, project.version);
      return applyOps(project, ops, result.version);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      const fresh = (await this.session(id)).project;
      const result = await this.ops(id, ops, fresh.version);
      return applyOps(fresh, ops, result.version);
    }
  }
  connect(
    url: string,
    onEvent: (event: s.ServerEvent) => void,
    onClose?: () => void,
  ): WebSocket {
    const ws = new WebSocket(resolveSessionWsUrl(url, this.options.wsOrigin));
    ws.onmessage = (message) => {
      try {
        const raw: unknown = JSON.parse(String(message.data));
        const parsed = s.serverEventSchema.safeParse(raw);
        if (parsed.success) onEvent(parsed.data);
      } catch {
        /* malformed packets cannot mutate project state */
      }
    };
    if (onClose) ws.onclose = onClose;
    return ws;
  }
}
