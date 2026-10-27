import { z } from 'zod';
import * as s from './schema';
export const restContracts = [
  {
    id: 'uploads',
    method: 'POST',
    path: '/v1/uploads',
    request: s.uploadRequestSchema,
    response: s.uploadResponseSchema,
  },
  {
    id: 'upload.put',
    method: 'PUT',
    path: '<signed single or multipart part URL>',
    response: null,
  },
  {
    id: 'upload.complete',
    method: 'POST',
    path: '/v1/uploads/:assetId/complete',
    request: s.completeRequestSchema,
    response: z.object({ ok: z.literal(true) }),
  },
  {
    id: 'sessions.create',
    method: 'POST',
    path: '/v1/sessions',
    request: s.sessionRequestSchema,
    response: s.sessionResponseSchema,
  },
  {
    id: 'sessions.read',
    method: 'GET',
    path: '/v1/sessions/:id',
    response: s.sessionSnapshotSchema,
  },
  {
    id: 'messages',
    method: 'POST',
    path: '/v1/sessions/:id/messages',
    request: s.messageRequestSchema,
    response: null,
  },
  {
    id: 'ops',
    method: 'POST',
    path: '/v1/sessions/:id/ops',
    request: s.opsRequestSchema,
    response: s.versionResponseSchema,
  },
  {
    id: 'approve',
    method: 'POST',
    path: '/v1/sessions/:id/approve',
    request: s.approvalOptionsSchema,
    response: s.approvalResponseSchema,
  },
  {
    id: 'renders.read',
    method: 'GET',
    path: '/v1/renders/:id',
    response: s.renderSchema,
  },
  {
    id: 'frame.get',
    method: 'GET',
    path: '/v1/renders/:id/frame.jpg?n=N',
    response: null,
  },
  {
    id: 'frame.head',
    method: 'HEAD',
    path: '/v1/renders/:id/frame.jpg?n=N',
    response: null,
  },
  {
    id: 'cancel',
    method: 'POST',
    path: '/v1/renders/:id/cancel',
    response: s.cancelRenderResponseSchema,
  },
  {
    id: 'reopen',
    method: 'POST',
    path: '/v1/sessions/:id/reopen',
    response: s.reopenSessionResponseSchema,
  },
  {
    id: 'videos.read',
    method: 'GET',
    path: '/v1/videos/:id',
    response: s.videoSchema,
  },
] as const;
export type RestContractId = (typeof restContracts)[number]['id'];
export type ContractOutcome =
  | 'fixture-pass'
  | 'live-observed-pass'
  | 'live-fail'
  | 'skipped'
  | 'unobserved';
export interface ContractObservation {
  id: string;
  outcome: ContractOutcome;
  reason?: string;
}
// Exhaustive keys make new wire variants a compile-time coverage failure.
export const serverVariants = {
  hello: true,
  'agent.status': true,
  'agent.action.start': true,
  'agent.action.progress': true,
  'agent.action.end': true,
  'project.ops': true,
  'agent.message': true,
  'asset.added': true,
  'sam.mask': true,
  'warmup.step': true,
  error: true,
} satisfies Record<s.ServerEvent['t'], true>;
export const clientVariants = {
  interrupt: true,
  pause: true,
  resume: true,
  ping: true,
} satisfies Record<s.ClientEvent['t'], true>;
export const operationVariants = {
  'project.update': true,
  'clip.add': true,
  'clip.update': true,
  'clip.remove': true,
  'clip.move': true,
  'clip.trim': true,
  'clip.split': true,
  'track.add': true,
  'track.remove': true,
  'track.update': true,
  'text.update': true,
  'effect.set': true,
  'keyframe.set': true,
  'marker.add': true,
} satisfies Record<s.Op['op'], true>;
/** Structural drift only: never include payload values in a report. */
export function strippedPaths(
  raw: unknown,
  parsed: unknown,
  prefix = '$',
): string[] {
  if (!raw || typeof raw !== 'object' || !parsed || typeof parsed !== 'object')
    return [];
  const result: string[] = [];
  const original = z.record(z.unknown()).safeParse(raw);
  const accepted = z.record(z.unknown()).safeParse(parsed);
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    raw
      .slice(0, 100)
      .forEach((item, i) =>
        result.push(...strippedPaths(item, parsed[i], `${prefix}[${i}]`)),
      );
  } else if (original.success && accepted.success) {
    // Names may contain user text. Report only bounded structural positions.
    Object.entries(original.data)
      .slice(0, 100)
      .forEach(([key, value], i) => {
        const path = `${prefix}.field[${i}]`;
        if (!Object.hasOwn(accepted.data, key)) result.push(path);
        else result.push(...strippedPaths(value, accepted.data[key], path));
      });
  }
  return result.slice(0, 100);
}
