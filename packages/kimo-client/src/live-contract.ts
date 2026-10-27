import { z } from 'zod';
import { KimoClient } from './client';
import { parseApiBase, resolveSessionWsUrl } from './config';
import * as s from './schema';
import {
  restContracts,
  serverVariants,
  clientVariants,
  strippedPaths,
  type ContractObservation,
  type RestContractId,
} from './contract-manifest';
export interface ContractRun {
  mode: 'read' | 'disposable-write';
  api: string;
  wsOrigin?: string;
  sessionId?: string;
  renderId?: string;
  videoId?: string;
  frame?: number;
  observeWs?: boolean;
  allowWrites?: boolean;
  maxSessions?: number;
  maxRenderStarts?: number;
  timeoutMs?: number;
  renderScenario?: 'cancel-and-reopen';
  maxUploadBytes?: number;
  uploadOrigins?: string[];
  uploadFixture?: {
    name: string;
    mime: string;
    bytes: Uint8Array;
    partSizeBytes?: number;
  };
}
/** Explicit invocation only. No ambient credentials or endpoint discovery. */
export async function runLiveContracts(
  input: ContractRun,
  request: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<ContractObservation[]> {
  const base = parseApiBase(input.api);
  const timeout = z
    .number()
    .int()
    .min(100)
    .max(30_000)
    .parse(input.timeoutMs ?? 5_000);
  if (
    input.mode === 'disposable-write' &&
    (!input.allowWrites ||
      input.maxSessions !== 1 ||
      (input.maxRenderStarts !== 0 && input.maxRenderStarts !== 1) ||
      (input.renderScenario !== undefined && input.maxRenderStarts !== 1))
  )
    throw new Error(
      'disposable authority requires one session and explicit zero/one render budget',
    );
  const deadline = AbortSignal.timeout(30_000);
  const rows: ContractObservation[] = restContracts.map((entry) => ({
    id: entry.id,
    outcome: 'skipped',
    reason: 'no authorized fixture or capability',
  }));
  for (const t of Object.keys(serverVariants))
    rows.push({ id: `ws.server.${t}`, outcome: 'unobserved' });
  for (const t of Object.keys(clientVariants))
    rows.push({
      id: `ws.client.${t}`,
      outcome: 'skipped',
      reason: 'no producer acknowledgement contract',
    });
  function record(
    id: string,
    outcome: ContractObservation['outcome'],
    reason?: string,
  ) {
    const row = rows.find((row) => row.id === id);
    if (row) Object.assign(row, { outcome, reason });
  }
  const bounded: typeof fetch = (url, init) => {
    const destination = new URL(url instanceof Request ? url.url : String(url));
    if (destination.origin !== new URL(base).origin)
      throw new Error('contract destination not approved');
    deadline.throwIfAborted();
    return request(url, {
      ...init,
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([deadline, AbortSignal.timeout(timeout)]),
      cache: 'no-store',
    });
  };
  const client = new KimoClient(base, bounded, {
    credentials: 'omit',
    wsOrigin: input.wsOrigin,
  });
  async function observe<T>(
    id: RestContractId,
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      const value = await action();
      record(id, 'live-observed-pass');
      return value;
    } catch {
      record(
        id,
        'live-fail',
        'request or schema validation failed; no automatic retry',
      );
      return undefined;
    }
  }
  async function read<T>(
    id: RestContractId,
    path: string,
    schema: z.ZodType<T>,
  ): Promise<T | undefined> {
    return observe(id, async () => {
      const response = await bounded(base + path);
      if (!response.ok) throw new Error();
      const raw: unknown = await response.json();
      const parsed = schema.parse(raw);
      const drift = strippedPaths(raw, parsed);
      if (drift.length)
        rows.push({
          id: `${id}.additive-drift`,
          outcome: 'live-observed-pass',
          reason: `unknown structural fields: ${drift.length}; not production agreement`,
        });
      return parsed;
    });
  }
  let uploadedAsset: string | undefined;
  if (input.mode === 'disposable-write' && input.uploadFixture) {
    const fixture = input.uploadFixture;
    const maxBytes = z
      .number()
      .int()
      .positive()
      .max(128 * 1024 * 1024)
      .parse(input.maxUploadBytes);
    if (fixture.bytes.byteLength > maxBytes)
      throw new Error('upload fixture exceeds explicit budget');
    const allowed = new Set(
      (input.uploadOrigins ?? []).map((origin) => {
        const parsed = parseApiBase(origin);
        if (new URL(parsed).origin !== parsed)
          throw new Error('upload origin must be exact');
        return parsed;
      }),
    );
    if (!allowed.size)
      throw new Error(
        'signed storage origin approval required before upload allocation',
      );
    const allocated = await observe('uploads', () =>
      client.uploads([
        {
          name: fixture.name,
          mime: fixture.mime,
          size: fixture.bytes.byteLength,
        },
      ]),
    );
    const upload = allocated?.uploads[0];
    if (upload) {
      const parts = await observe('upload.put', async () => {
        const targets = upload.parts ?? [
          { partNumber: 1, putUrl: upload.putUrl },
        ];
        if (targets.length > 32)
          throw new Error('multipart request budget exceeded');
        const chunkSize = upload.parts
          ? z.number().int().positive().parse(fixture.partSizeBytes)
          : fixture.bytes.byteLength;
        if (targets.length !== Math.ceil(fixture.bytes.byteLength / chunkSize))
          throw new Error('part sizing agreement missing');
        const result: { partNumber: number; etag: string }[] = [];
        for (let i = 0; i < targets.length; i++) {
          const target = targets[i];
          if (!target || target.partNumber !== i + 1)
            throw new Error('invalid part order');
          const destination = new URL(target.putUrl);
          if (
            !allowed.has(destination.origin) ||
            destination.username ||
            destination.password ||
            destination.hash
          )
            throw new Error('signed destination not approved');
          const headers = new Headers(upload.headers);
          if (headers.has('cookie') || headers.has('authorization'))
            throw new Error('API credentials forbidden on storage writes');
          const bytes = fixture.bytes.slice(
            i * chunkSize,
            Math.min((i + 1) * chunkSize, fixture.bytes.byteLength),
          );
          deadline.throwIfAborted();
          const response = await request(target.putUrl, {
            method: 'PUT',
            body: bytes,
            headers,
            credentials: 'omit',
            redirect: 'error',
            signal: AbortSignal.any([deadline, AbortSignal.timeout(timeout)]),
          });
          if (!response.ok) throw new Error('upload failed');
          const etag = response.headers.get('ETag');
          if (upload.parts && !etag)
            throw new Error('multipart ETag unavailable');
          result.push({ partNumber: target.partNumber, etag: etag ?? '' });
        }
        return result;
      });
      if (parts) {
        if (upload.parts) {
          const completed = await observe('upload.complete', () =>
            client.completeUpload(upload.assetId, parts),
          );
          if (completed) uploadedAsset = upload.assetId;
        } else uploadedAsset = upload.assetId;
      }
    }
    if (!uploadedAsset) return rows; // uncertain upload is never followed by dependent writes
  }
  let sessionId = input.sessionId;
  if (input.mode === 'disposable-write') {
    // Only this freshly created disposable session is ever mutated. Unknown POST
    // outcomes are recorded and never retried or followed by dependent writes.
    const created = await observe('sessions.create', () =>
      client.createSession({
        prompt: 'disposable contract fixture',
        assetIds: uploadedAsset ? [uploadedAsset] : [],
        aspect: '16:9',
      }),
    );
    sessionId = created?.sessionId;
    if (sessionId)
      rows.push({
        id: 'disposable.resource',
        outcome: 'live-observed-pass',
        reason:
          'created one service resource; cleanup/retention not established',
      });
  }
  let writesKnown = true;
  const snapshot = sessionId
    ? await read(
        'sessions.read',
        `/v1/sessions/${encodeURIComponent(sessionId)}`,
        s.sessionSnapshotSchema,
      )
    : undefined;
  if (
    input.mode === 'disposable-write' &&
    sessionId &&
    snapshot?.status === 'editing'
  ) {
    const sent = await observe('messages', async () => {
      await client.message(sessionId, 'disposable contract observation');
      return true;
    });
    if (sent) {
      const acknowledged = await observe('ops', () =>
        client.ops(sessionId, [], snapshot.project.version),
      );
      writesKnown = acknowledged !== undefined;
    } else writesKnown = false;
  }
  if (
    input.mode === 'disposable-write' &&
    writesKnown &&
    sessionId &&
    snapshot &&
    (snapshot.status === 'editing' || snapshot.status === 'awaiting_review') &&
    input.renderScenario === 'cancel-and-reopen'
  ) {
    const approved = await observe('approve', () => client.approve(sessionId));
    if (approved) {
      const render = await observe('renders.read', () =>
        client.render(approved.renderId),
      );
      if (
        render &&
        (render.status === 'queued' || render.status === 'rendering')
      ) {
        const cancelled = await observe('cancel', () =>
          client.cancelRender(approved.renderId),
        );
        if (cancelled)
          await observe('reopen', () => client.reopenSession(sessionId));
      }
      // A raced terminal render is not deliberately failed, replaced or retried.
    }
  }
  if (input.renderId) {
    await read(
      'renders.read',
      `/v1/renders/${encodeURIComponent(input.renderId)}`,
      s.renderSchema,
    );
    if (input.frame !== undefined) {
      const url = client.renderFrameUrl(input.renderId, input.frame);
      for (const method of ['GET', 'HEAD'] as const)
        await observe(
          method === 'GET' ? 'frame.get' : 'frame.head',
          async () => {
            const response = await bounded(url, { method });
            if (
              !response.ok ||
              !response.headers.get('content-type')?.startsWith('image/jpeg')
            )
              throw new Error();
            // Bounded stream inspection, not a potentially unbounded media download.
            if (method === 'GET') {
              const reader = response.body?.getReader();
              if (!reader) throw new Error();
              const signature: number[] = [];
              while (signature.length < 2) {
                const chunk = await reader.read();
                if (chunk.done) break;
                for (const byte of chunk.value) {
                  signature.push(byte);
                  if (signature.length === 2) break;
                }
              }
              await reader.cancel();
              if (signature[0] !== 255 || signature[1] !== 216)
                throw new Error();
            } else if ((await response.arrayBuffer()).byteLength)
              throw new Error();
          },
        );
    }
  }
  if (input.videoId)
    await read(
      'videos.read',
      `/v1/videos/${encodeURIComponent(input.videoId)}`,
      s.videoSchema,
    );
  if (input.observeWs && snapshot?.wsUrl) {
    if (typeof WebSocket === 'undefined')
      rows.push({
        id: 'ws.runtime',
        outcome: 'skipped',
        reason: 'native WebSocket unavailable; no dependency installed',
      });
    else
      await new Promise<void>((resolve) => {
        let socket: WebSocket;
        try {
          socket = new WebSocket(
            resolveSessionWsUrl(snapshot.wsUrl ?? '', input.wsOrigin),
          );
        } catch {
          rows.push({
            id: 'ws.connection',
            outcome: 'live-fail',
            reason: 'invalid session routing',
          });
          resolve();
          return;
        }
        const finish = () => {
          clearTimeout(timer);
          socket.onmessage = socket.onerror = socket.onclose = null;
          socket.close();
          resolve();
        };
        const timer = setTimeout(finish, timeout);
        socket.onclose = finish;
        socket.onerror = () => {
          rows.push({
            id: 'ws.connection',
            outcome: 'live-fail',
            reason: 'connection failed',
          });
          finish();
        };
        let messageCount = 0;
        socket.onmessage = (event) => {
          if (++messageCount > 128) {
            finish();
            return;
          }
          try {
            const raw: unknown = JSON.parse(String(event.data));
            const parsed = s.serverEventSchema.parse(raw);
            record(`ws.server.${parsed.t}`, 'live-observed-pass');
          } catch {
            rows.push({
              id: 'ws.invalid',
              outcome: 'live-fail',
              reason: 'invalid observed packet',
            });
          }
        };
      });
  }
  return rows;
}
