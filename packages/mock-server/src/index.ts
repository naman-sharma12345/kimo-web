import { targetsLockedEntity } from './agent-locks';
import http from 'node:http';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mediaResponse } from './media-response';
import { WebSocketServer, WebSocket } from 'ws';
import {
  applyOps,
  uploadRequestSchema,
  completeRequestSchema,
  sessionRequestSchema,
  messageRequestSchema,
  opsRequestSchema,
  clientEventSchema,
  type Asset,
  type Clip,
  type KimoProject,
  type Op,
  type ServerEvent,
  type SessionSnapshot,
  type Upload,
} from '@kimo/client';
export function createMockServer(
  options: {
    port?: number;
    speed?: number;
    fail?: string;
    dataDir?: string;
    multipartThreshold?: number;
    partSize?: number;
  } = {},
) {
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const speed = options.speed ?? Number(process.env.MOCK_SPEED ?? 1);
  if (!Number.isFinite(speed) || speed <= 0)
    throw new Error('MOCK_SPEED must be positive');
  const multipartThreshold = options.multipartThreshold ?? 100 * 1024 ** 2;
  const partSize = options.partSize ?? 16 * 1024 ** 2;
  if (
    !Number.isSafeInteger(partSize) ||
    partSize <= 0 ||
    !Number.isSafeInteger(multipartThreshold) ||
    multipartThreshold < 0
  )
    throw new Error('invalid multipart configuration');
  const fail = options.fail ?? process.env.MOCK_FAIL;
  let base = `http://localhost:${port}`;
  const data = resolve(options.dataDir ?? '.mock-data');
  mkdirSync(data, { recursive: true });
  const fixtureDir = resolve(
    process.cwd().endsWith('mock-server')
      ? 'fixtures'
      : 'packages/mock-server/fixtures',
  );
  interface Uploaded {
    asset: Asset;
    size: number;
    complete: boolean;
    expires: number;
    parts: number;
    etags: Map<number, string>;
    finalizing?: Promise<void>;
  }
  interface Session {
    snapshot: SessionSnapshot;
    sockets: Set<WebSocket>;
    started: boolean;
    paused: boolean;
    timers: Set<ReturnType<typeof setTimeout>>;
  }
  const uploads = new Map<string, Uploaded>();
  const sessions = new Map<string, Session>();
  const renders = new Map<string, { sessionId: string; started: number }>();
  const emit = (s: Session, event: ServerEvent) => {
    if (event.t === 'agent.action.start') {
      const actionIds = (s.snapshot.actionIds ??= []);
      if (!actionIds.includes(event.id)) actionIds.push(event.id);
    }
    for (const ws of s.sockets)
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  };
  const later = (s: Session, ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      s.timers.delete(timer);
      fn();
    }, ms / speed);
    s.timers.add(timer);
  };
  const project = (id: string, vertical = false): KimoProject => ({
    id,
    version: 0,
    fps: 30,
    width: vertical ? 1080 : 1920,
    height: vertical ? 1920 : 1080,
    duration: 0,
    tracks: [],
    clips: {},
    markers: [],
  });
  const clip = (
    id: string,
    assetId: string,
    kind: Clip['kind'] = 'video',
    start = 0,
  ): Clip => ({
    id,
    assetId,
    trackId: kind === 'audio' ? 'a1' : kind === 'text' ? 't1' : 'v1',
    kind,
    start,
    duration: 8,
    in: 0,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    effects: [],
    keyframes: [],
    speed: 1,
  });
  const fixtureAssets: Asset[] = [1, 2, 3].map((i) => ({
    id: `fixture-${i}`,
    kind: 'video',
    name: `clip-${i}.mp4`,
    url: `${base}/fixtures/clip-${i}.mp4`,
    thumbUrl: `${base}/fixtures/image.png`,
    durationSec: 8,
    width: 1920,
    height: 1080,
    source: 'user',
  }));
  function batch(s: Session, ops: Op[], actionId?: string) {
    if (actionId && targetsLockedEntity(s.snapshot.project, ops)) return false;
    s.snapshot.project = applyOps(s.snapshot.project, ops);
    emit(s, {
      t: 'project.ops',
      version: s.snapshot.project.version,
      ops,
      actionId,
      author: actionId ? 'agent' : 'user',
    });
    return true;
  }
  function action(
    s: Session,
    i: number,
    ops: Op[],
    tool: string,
    title: string,
  ) {
    const id = `action-${i}-${randomUUID()}`;
    emit(s, { t: 'agent.status', state: 'acting', label: title });
    const samTarget =
      tool === 'sam_mask'
        ? {
            clipId: 'c2',
            time: 7,
            coordinateSpace: 'source_uv' as const,
            subjectLabel: 'synthetic ellipse',
            previewPolygon: Array.from(
              { length: 16 },
              (_, point): [number, number] => {
                const angle = (point * Math.PI) / 8;
                return [
                  0.5 + (Math.cos(angle) * 110) / 640,
                  0.5 + (Math.sin(angle) * 155) / 360,
                ];
              },
            ),
          }
        : undefined;
    emit(s, {
      t: 'agent.action.start',
      id,
      tool,
      title,
      args: {},
      ...(samTarget ? { target: samTarget } : {}),
    });
    const applied = batch(s, ops, id);
    if (samTarget && applied)
      emit(s, {
        t: 'sam.mask',
        actionId: id,
        clipId: samTarget.clipId,
        maskAssetId: 'mask-2',
        coordinateSpace: samTarget.coordinateSpace,
        subjectLabel: samTarget.subjectLabel,
        previewPolygon: samTarget.previewPolygon,
      });
    emit(s, { t: 'agent.action.progress', id, pct: 1 });
    emit(s, {
      t: 'agent.action.end',
      id,
      ok: applied,
      ...(!applied ? { error: 'clip or track is locked' } : {}),
      durationMs: Math.round(1200 / speed),
    });
  }
  function script(s: Session) {
    if (s.started) return;
    if (
      s.snapshot.assets.some(
        (asset) => uploads.has(asset.id) && !uploads.get(asset.id)?.complete,
      )
    ) {
      emit(s, { t: 'warmup.step', step: 'upload', pct: 0 });
      later(s, Math.max(100, 100 * speed), () => script(s));
      return;
    }
    s.started = true;
    const steps = ['upload', 'probe', 'watch', 'plan', 'ready'] as const;
    steps.forEach((step, i) =>
      later(s, i * 1500, () => {
        emit(s, { t: 'warmup.step', step, pct: 1 });
        if (step === 'watch')
          emit(s, {
            t: 'agent.status',
            state: 'thinking',
            label: 'looking for the best moments…',
          });
        if (step === 'ready' && s.snapshot.status === 'warming')
          s.snapshot.status = 'editing';
      }),
    );
    for (const asset of [
      ...fixtureAssets,
      {
        id: 'fixture-music',
        kind: 'audio' as const,
        name: 'music.wav',
        url: `${base}/fixtures/music.wav`,
        durationSec: 24,
        source: 'user' as const,
      },
      {
        id: 'mask-2',
        kind: 'image' as const,
        name: 'synthetic ellipse mask (not SAM inference)',
        url: `${base}/fixtures/mask.png`,
        mask: {
          encoding: 'luma_image' as const,
          width: 640,
          height: 360,
          coordinateSpace: 'source_uv' as const,
          channel: 'luma' as const,
        },
        source: 'user' as const,
      },
    ]) {
      if (!s.snapshot.assets.some((a) => a.id === asset.id)) {
        s.snapshot.assets.push(asset);
        emit(s, { t: 'asset.added', asset });
      }
    }
    const a = s.snapshot.assets.filter((a) => a.kind === 'video');
    const refs = a.length ? a : fixtureAssets;
    const ops: { ops: Op[]; tool: string; title: string }[] = [];
    const push = (op: Op, tool: string, title: string) =>
      ops.push({ ops: [op], tool, title });
    for (const [id, kind, name, height] of [
      ['v1', 'video', 'video', 64],
      ['t1', 'text', 'titles', 48],
      ['a1', 'audio', 'music', 48],
    ] as const)
      push(
        {
          op: 'track.add',
          track: {
            id,
            kind,
            name,
            muted: false,
            hidden: false,
            locked: false,
            height,
          },
        },
        'create_track',
        `setting up ${name}`,
      );
    for (let i = 0; i < 3; i++)
      push(
        {
          op: 'clip.add',
          clip: clip(
            `c${i + 1}`,
            refs[i % refs.length]?.id ?? 'fixture-1',
            'video',
            i * 7,
          ),
        },
        'import_clip',
        `importing clip ${i + 1}`,
      );
    for (let i = 1; i <= 3; i++) {
      push(
        { op: 'clip.trim', id: `c${i}`, edge: 'out', value: 7 },
        'trim_clip',
        `tightening clip ${i}`,
      );
      push(
        { op: 'clip.move', id: `c${i}`, trackId: 'v1', start: (3 - i) * 7 },
        'move_clip',
        `reordering clip ${i}`,
      );
    }
    const title = {
      ...clip('title', 'unused', 'text'),
      assetId: undefined,
      duration: 4,
      text: { content: 'a story in motion', style: 'title' as const },
    };
    push(
      { op: 'clip.add', clip: title },
      'add_title',
      'adding the opening title',
    );
    push(
      {
        op: 'clip.add',
        clip: {
          ...clip('captions', 'unused', 'text'),
          assetId: undefined,
          duration: 21,
          text: {
            content: 'every moment tells a story',
            style: 'caption',
            words: ['every', 'moment', 'tells', 'a', 'story'].map((w, i) => ({
              w,
              t: i * 0.4,
              d: 0.4,
            })),
          },
        },
      },
      'add_captions',
      'writing word-level captions',
    );
    for (let i = 1; i <= 3; i++)
      push(
        {
          op: 'effect.set',
          clipId: `c${i}`,
          effect: {
            id: 'grade',
            kind: 'colour_grade',
            params: { contrast: 1.08, saturation: 0.94, temperature: 0.03 },
          },
        },
        'colour_grade',
        `balancing clip ${i}`,
      );
    push(
      {
        op: 'clip.update',
        id: 'c2',
        patch: {
          mask: {
            kind: 'sam',
            maskAssetId: 'mask-2',
            invert: false,
            feather: 0.1,
          },
        },
      },
      'sam_mask',
      'isolating the subject',
    );
    push(
      {
        op: 'clip.add',
        clip: {
          ...clip('music', 'fixture-music', 'audio'),
          duration: 21,
          volume: 0.3,
          audioRole: 'music',
        },
      },
      'add_music',
      'placing the music',
    );
    push(
      {
        op: 'effect.set',
        clipId: 'music',
        effect: {
          id: 'duck',
          kind: 'ducking',
          params: { threshold: 0.2, gain: 0.3 },
        },
      },
      'duck_music',
      'making room for speech',
    );
    for (const id of ['c2', 'c3'])
      push(
        {
          op: 'clip.update',
          id,
          patch: { transitionIn: { kind: 'crossfade', duration: 0.3 } },
        },
        'add_transition',
        'softening the cut',
      );
    // Each remaining action makes a distinct, visible editorial change.
    for (const id of ['c1', 'c2', 'c3']) {
      push(
        {
          op: 'clip.update',
          id,
          patch: {
            transform: { x: 0, y: 0, scale: 1.04, rotation: 0, opacity: 1 },
          },
        },
        'reframe_clip',
        'tightening the composition',
      );
      push(
        {
          op: 'keyframe.set',
          clipId: id,
          keyframe: { property: 'scale', time: 0, value: 1.04 },
        },
        'animate_reframe',
        'starting a gentle push in',
      );
      push(
        {
          op: 'keyframe.set',
          clipId: id,
          keyframe: { property: 'scale', time: 7, value: 1.1 },
        },
        'animate_reframe',
        'finishing the gentle push in',
      );
      push(
        { op: 'clip.update', id, patch: { volume: 0.8 } },
        'balance_audio',
        'balancing location audio',
      );
    }
    push(
      {
        op: 'clip.add',
        clip: {
          ...clip('web-image', 'web-original', 'image', 10),
          duration: 2,
          transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.8 },
        },
      },
      'add_web_image',
      'placing the attributed cutaway',
    );
    push(
      {
        op: 'keyframe.set',
        clipId: 'title',
        keyframe: { property: 'opacity', time: 0, value: 0 },
      },
      'animate_title',
      'fading in the title',
    );
    push(
      {
        op: 'keyframe.set',
        clipId: 'title',
        keyframe: { property: 'opacity', time: 0.4, value: 1 },
      },
      'animate_title',
      'revealing the title',
    );
    push(
      {
        op: 'keyframe.set',
        clipId: 'title',
        keyframe: { property: 'opacity', time: 3.6, value: 1 },
      },
      'animate_title',
      'holding the title',
    );
    push(
      {
        op: 'keyframe.set',
        clipId: 'title',
        keyframe: { property: 'opacity', time: 4, value: 0 },
      },
      'animate_title',
      'fading out the title',
    );
    push(
      {
        op: 'keyframe.set',
        clipId: 'music',
        keyframe: { property: 'volume', time: 0, value: 0 },
      },
      'fade_music',
      'bringing in the music',
    );
    push(
      {
        op: 'keyframe.set',
        clipId: 'music',
        keyframe: { property: 'volume', time: 1, value: 0.3 },
      },
      'fade_music',
      'settling the music level',
    );
    push(
      {
        op: 'keyframe.set',
        clipId: 'music',
        keyframe: { property: 'volume', time: 19, value: 0.3 },
      },
      'fade_music',
      'holding the final music beat',
    );
    push(
      {
        op: 'keyframe.set',
        clipId: 'music',
        keyframe: { property: 'volume', time: 21, value: 0 },
      },
      'fade_music',
      'fading the music out',
    );
    push(
      {
        op: 'clip.update',
        id: 'captions',
        patch: {
          transform: { x: 0, y: 400, scale: 1, rotation: 0, opacity: 1 },
        },
      },
      'position_captions',
      'keeping captions in the safe area',
    );
    push(
      {
        op: 'marker.add',
        marker: { id: 'review', time: 0, label: 'ready for review' },
      },
      'mark_review',
      'marking the finished sequence',
    );
    ops.forEach((entry, i) =>
      later(s, 6500 + i * (70000 / 45), function run() {
        if (s.paused) {
          later(s, 200, run);
          return;
        }
        if (i === 18) {
          const asset: Asset = {
            id: 'web-original',
            kind: 'image',
            name: 'original test pattern',
            url: `${base}/fixtures/image.png`,
            source: 'web',
            attribution: {
              site: 'kimo-web original fixture',
              pageUrl: 'https://github.com/naman-sharma12345/kimo-web',
              license: 'CC0-1.0',
            },
          };
          s.snapshot.assets.push(asset);
          emit(s, { t: 'asset.added', asset });
        }
        action(s, i, entry.ops, entry.tool, entry.title);
        if (i === ops.length - 1 && s.snapshot.status === 'editing') {
          s.snapshot.status = 'awaiting_review';
          emit(s, {
            t: 'agent.message',
            id: randomUUID(),
            role: 'agent',
            text: 'the edit is ready. play it and tell me what you think.',
            kind: 'ask_review',
          });
        }
      }),
    );
  }
  async function body(req: http.IncomingMessage): Promise<unknown> {
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += b.length;
      if (size > 1024 * 1024) throw new Error('request body too large');
      parts.push(b);
    }
    return JSON.parse(Buffer.concat(parts).toString() || '{}') as unknown;
  }
  function json(res: http.ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,ETag');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const path = new URL(req.url ?? '/', base).pathname;
    const segments = path.split('/');
    try {
      if (path === '/health') {
        json(res, 200, { ok: true });
        return;
      }
      if (path.startsWith('/fixtures/')) {
        const name = segments[2];
        if (
          !name ||
          ![
            'clip-1.mp4',
            'clip-2.mp4',
            'clip-3.mp4',
            'music.wav',
            'image.png',
            'mask.png',
            'identity-lut.png',
          ].includes(name)
        ) {
          json(res, 404, { error: 'not found' });
          return;
        }
        const file = resolve(fixtureDir, name);
        if (!existsSync(file)) {
          json(res, 404, { error: 'run postinstall fixtures' });
          return;
        }
        res.setHeader(
          'Content-Type',
          name.endsWith('.mp4')
            ? 'video/mp4'
            : name.endsWith('.png')
              ? 'image/png'
              : 'audio/wav',
        );
        await mediaResponse(req, res, file);
        return;
      }
      if (path.startsWith('/mock-r2/') && req.method === 'PUT') {
        const id = segments[2] ?? '';
        const upload = uploads.get(id);
        if (!upload || upload.expires < Date.now()) {
          json(res, 403, { error: 'expired upload' });
          return;
        }
        if (fail === 'upload') {
          json(res, 503, { error: 'simulated upload failure' });
          return;
        }
        const part = segments[3];
        if (
          part &&
          (!/^\d+$/.test(part) ||
            Number(part) < 1 ||
            Number(part) > upload.parts)
        ) {
          json(res, 400, { error: 'invalid part' });
          return;
        }
        if (upload.complete || upload.finalizing) {
          json(res, 409, { error: 'upload already finalized' });
          return;
        }
        if (upload.parts > 0 && !part) {
          json(res, 400, { error: 'multipart upload requires a part number' });
          return;
        }
        const partNumber = part ? Number(part) : 0;
        const expected = part
          ? Math.min(partSize, upload.size - (partNumber - 1) * partSize)
          : upload.size;
        const temporary = resolve(data, `${id}-${randomUUID()}.tmp`);
        await pipeline(req, createWriteStream(temporary));
        if (statSync(temporary).size !== expected) {
          unlinkSync(temporary);
          json(res, 400, { error: 'upload size mismatch' });
          return;
        }
        const etag = `"${randomUUID()}"`;
        renameSync(
          temporary,
          resolve(data, `${id}${part ? '-' + partNumber : ''}`),
        );
        upload.etags.set(partNumber, etag);
        if (!part) upload.complete = true;
        res.setHeader('ETag', etag);
        json(res, 200, { ok: true });
        return;
      }
      if (path.startsWith('/media/')) {
        const id = segments[2] ?? '';
        if (!uploads.get(id)?.complete || !existsSync(resolve(data, id))) {
          json(res, 404, { error: 'not found' });
          return;
        }
        res.setHeader(
          'Content-Type',
          uploads.get(id)?.asset.kind === 'video'
            ? 'video/mp4'
            : 'application/octet-stream',
        );
        await mediaResponse(req, res, resolve(data, id));
        return;
      }
      if (path === '/v1/uploads' && req.method === 'POST') {
        const input = uploadRequestSchema.parse(await body(req));
        const result: Upload[] = input.files.map((file) => {
          const id = randomUUID();
          const parts =
            file.size > multipartThreshold
              ? Math.ceil(file.size / partSize)
              : 0;
          uploads.set(id, {
            asset: {
              id,
              name: file.name,
              kind: file.mime.startsWith('video')
                ? 'video'
                : file.mime.startsWith('image')
                  ? 'image'
                  : file.mime.startsWith('audio')
                    ? 'audio'
                    : 'doc',
              url: `${base}/media/${id}`,
              source: 'user',
            },
            size: file.size,
            complete: false,
            expires: Date.now() + 15 * 60 * 1000,
            parts,
            etags: new Map(),
          });
          return {
            assetId: id,
            putUrl: `${base}/mock-r2/${id}`,
            headers: {},
            ...(parts
              ? {
                  parts: Array.from({ length: parts }, (_, i) => ({
                    partNumber: i + 1,
                    putUrl: `${base}/mock-r2/${id}/${i + 1}`,
                  })),
                }
              : {}),
          };
        });
        json(res, 200, { uploads: result });
        return;
      }
      if (
        segments[1] === 'v1' &&
        segments[2] === 'uploads' &&
        segments[4] === 'complete' &&
        req.method === 'POST'
      ) {
        const id = segments[3] ?? '';
        const upload = uploads.get(id);
        const input = completeRequestSchema.parse(await body(req));
        const ordered = [...input.parts].sort(
          (a, b) => a.partNumber - b.partNumber,
        );
        if (
          !upload ||
          upload.parts === 0 ||
          upload.expires < Date.now() ||
          input.parts.length !== upload.parts ||
          ordered.some(
            (p, i) =>
              p.partNumber !== i + 1 ||
              p.etag !== upload.etags.get(i + 1) ||
              !existsSync(resolve(data, `${id}-${i + 1}`)),
          )
        ) {
          json(res, 400, { error: 'missing multipart parts' });
          return;
        }
        if (upload.complete) {
          json(res, 200, { ok: true });
          return;
        }
        if (
          ordered.some(
            (part) =>
              statSync(resolve(data, `${id}-${part.partNumber}`)).size !==
              Math.min(
                partSize,
                upload.size - (part.partNumber - 1) * partSize,
              ),
          )
        ) {
          json(res, 400, { error: 'part size mismatch' });
          return;
        }
        upload.finalizing ??= (async () => {
          const temporary = resolve(data, `${id}-final.tmp`);
          async function* chunks() {
            for (const part of ordered) {
              for await (const chunk of createReadStream(
                resolve(data, `${id}-${part.partNumber}`),
              )) {
                yield chunk as Buffer;
              }
            }
          }
          await pipeline(chunks(), createWriteStream(temporary));
          renameSync(temporary, resolve(data, id));
          upload.complete = true;
        })();
        try {
          await upload.finalizing;
        } catch (error) {
          upload.finalizing = undefined;
          throw error;
        }
        json(res, 200, { ok: true });
        return;
      }
      if (path === '/v1/sessions' && req.method === 'POST') {
        const input = sessionRequestSchema.parse(await body(req));
        if (input.assetIds.some((id) => !uploads.has(id))) {
          json(res, 400, { error: 'unknown asset' });
          return;
        }
        const id = randomUUID();
        const wsUrl = `${base.replace('http:', 'ws:')}/v1/sessions/${id}/ws`;
        sessions.set(id, {
          snapshot: {
            status: 'warming',
            actionIds: [],
            project: project(id, input.aspect === '9:16'),
            assets: input.assetIds.flatMap((id) => {
              const upload = uploads.get(id);
              return upload ? [upload.asset] : [];
            }),
            wsUrl,
          },
          sockets: new Set(),
          started: false,
          paused: false,
          timers: new Set(),
        });
        json(res, 200, { sessionId: id, wsUrl });
        return;
      }
      if (segments[1] === 'v1' && segments[2] === 'sessions') {
        const id = segments[3] ?? '';
        const s = sessions.get(id);
        if (!s) {
          json(res, 404, { error: 'unknown session' });
          return;
        }
        if (segments.length === 4 && req.method === 'GET') {
          json(res, 200, s.snapshot);
          return;
        }
        if (segments[4] === 'ops' && req.method === 'POST') {
          const input = opsRequestSchema.parse(await body(req));
          if (input.baseVersion !== s.snapshot.project.version) {
            json(res, 409, { error: 'version conflict' });
            return;
          }
          batch(s, input.ops);
          json(res, 200, { version: s.snapshot.project.version });
          return;
        }
        if (segments[4] === 'messages' && req.method === 'POST') {
          const input = messageRequestSchema.parse(await body(req));
          const attachments = [...new Set(input.attachments ?? [])];
          if (attachments.some((id) => !uploads.get(id)?.complete)) {
            json(res, 400, { error: 'attachment is missing or not uploaded' });
            return;
          }
          for (const id of attachments) {
            const asset = uploads.get(id)?.asset;
            if (
              asset &&
              !s.snapshot.assets.some((current) => current.id === id)
            ) {
              s.snapshot.assets.push(asset);
              emit(s, { t: 'asset.added', asset });
            }
          }
          if (input.text.trim()) interrupt(s, input.text);
          json(res, 202, { accepted: true });
          return;
        }
        if (segments[4] === 'approve' && req.method === 'POST') {
          const renderId = randomUUID();
          s.snapshot.status = 'rendering';
          s.snapshot.renderId = renderId;
          later(s, 25000, () => {
            s.snapshot.status = fail === 'render' ? 'failed' : 'done';
            if (fail !== 'render') s.snapshot.videoId = id;
          });
          renders.set(renderId, { sessionId: id, started: Date.now() });
          json(res, 200, { renderId });
          return;
        }
      }
      if (segments[2] === 'renders' && req.method === 'GET') {
        const render = renders.get(segments[3] ?? '');
        if (!render) {
          json(res, 404, { error: 'unknown render' });
          return;
        }
        const progress = Math.min(
          1,
          (Date.now() - render.started) / (25000 / speed),
        );
        const s = sessions.get(render.sessionId);
        if (!s) {
          json(res, 404, { error: 'unknown session' });
          return;
        }
        if (progress === 1) {
          s.snapshot.status = fail === 'render' ? 'failed' : 'done';
          if (fail !== 'render') s.snapshot.videoId = render.sessionId;
        }
        json(res, 200, {
          status:
            fail === 'render'
              ? 'failed'
              : progress === 1
                ? 'done'
                : 'rendering',
          progress,
          frame: Math.floor(progress * 630),
          totalFrames: 630,
          etaSec: Math.ceil(((1 - progress) * 25) / speed),
          ...(progress === 1 && fail !== 'render'
            ? { videoId: render.sessionId }
            : {}),
        });
        return;
      }
      if (segments[2] === 'videos' && req.method === 'GET') {
        const s = sessions.get(segments[3] ?? '');
        if (!s || s.snapshot.status !== 'done') {
          json(res, 404, { error: 'unknown video' });
          return;
        }
        json(res, 200, {
          url: `${base}/fixtures/clip-1.mp4`,
          posterUrl: `${base}/fixtures/image.png`,
          durationSec: 8,
          width: 1920,
          height: 1080,
          sizeBytes: existsSync(resolve(fixtureDir, 'clip-1.mp4'))
            ? readFileSync(resolve(fixtureDir, 'clip-1.mp4')).length
            : 0,
          title: 'mock preview only, not an engine render',
        });
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : 'invalid request',
      });
    }
  });
  function interrupt(s: Session, text: string) {
    emit(s, {
      t: 'agent.status',
      state: 'thinking',
      label: 'reading your note',
    });
    const slower = text.toLowerCase().includes('slower');
    Object.values(s.snapshot.project.clips)
      .filter((c) => c.kind === 'video')
      .slice(0, 3)
      .forEach((c, i) =>
        later(s, 100 + i * 50, () =>
          action(
            s,
            100 + i,
            [
              {
                op: 'clip.update',
                id: c.id,
                patch: slower
                  ? { duration: c.duration * 1.25, speed: 0.8 }
                  : { transform: { ...c.transform, scale: 1.05 } },
              },
            ],
            'respond_to_note',
            slower ? 'giving this moment more time' : 'refining the framing',
          ),
        ),
      );
    later(s, 300, () =>
      emit(s, {
        t: 'agent.message',
        id: randomUUID(),
        role: 'agent',
        text: slower
          ? 'i slowed the clips and gave each moment more room.'
          : 'i adjusted the framing. tell me what else to change.',
        kind: 'say',
      }),
    );
  }
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    const id = (req.url ?? '').split('/')[3] ?? '';
    const s = sessions.get(id);
    if (!s || fail === 'ws') {
      ws.close(1011, 'simulated connection failure');
      return;
    }
    s.sockets.add(ws);
    ws.send(
      JSON.stringify({ t: 'hello', version: s.snapshot.project.version }),
    );
    if (s.snapshot.status === 'warming' && s.started)
      ws.send(JSON.stringify({ t: 'warmup.step', step: 'watch', pct: 0.5 }));
    if (s.snapshot.status !== 'warming')
      ws.send(JSON.stringify({ t: 'warmup.step', step: 'ready', pct: 1 }));
    script(s);
    ws.on('message', (raw) => {
      try {
        const event = clientEventSchema.parse(JSON.parse(raw.toString()));
        if (event.t === 'interrupt') interrupt(s, event.text);
        if (event.t === 'pause') s.paused = true;
        if (event.t === 'resume') s.paused = false;
      } catch {
        ws.send(
          JSON.stringify({
            t: 'error',
            code: 'INVALID_PACKET',
            message: 'invalid client packet',
          }),
        );
      }
    });
    ws.on('close', () => s.sockets.delete(ws));
  });
  return {
    server,
    async start() {
      await new Promise<void>((r) => server.listen(port, r));
      const address = server.address();
      if (address && typeof address !== 'string') {
        const previous = base;
        base = `http://localhost:${address.port}`;
        for (const asset of fixtureAssets) {
          asset.url = asset.url.replace(previous, base);
          if (asset.thumbUrl)
            asset.thumbUrl = asset.thumbUrl.replace(previous, base);
        }
      }
      return base;
    },
    async close() {
      for (const s of sessions.values())
        for (const timer of s.timers) clearTimeout(timer);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r, reject) =>
        server.close((error) => (error ? reject(error) : r())),
      );
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const mock = createMockServer();
  void mock
    .start()
    .then((base) => console.log(`kimo mock listening on ${base}`));
  const shutdown = () => {
    void mock.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
