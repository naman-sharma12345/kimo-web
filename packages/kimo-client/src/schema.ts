import { z } from 'zod';
const id = z.string().min(1);
const sec = z.number().finite().nonnegative();
export const attributionSchema = z.object({
  site: z.string(),
  pageUrl: z.string().url(),
  license: z.string().optional(),
});
export const assetSchema = z.object({
  id,
  kind: z.enum(['video', 'image', 'audio', 'doc']),
  name: z.string(),
  url: z.string(),
  proxyUrl: z.string().optional(),
  thumbUrl: z.string().optional(),
  durationSec: sec.optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  source: z.enum(['user', 'web']),
  attribution: attributionSchema.optional(),
});
export const effectSchema = z.object({
  id,
  kind: z.string(),
  params: z.record(z.union([z.string(), z.number(), z.boolean()])),
});
export const keyframeSchema = z.object({
  property: z.string(),
  time: sec,
  value: z.number(),
  easing: z.enum(['linear', 'ease_out', 'ease_in_out']).optional(),
});
export const transitionSchema = z.object({
  kind: z.enum(['cut', 'crossfade', 'dip']),
  duration: sec,
});
export const markerSchema = z.object({ id, time: sec, label: z.string() });
export const textStyleIdSchema = z.enum(['title', 'caption', 'lower_third']);
export const clipSchema = z.object({
  id,
  trackId: id,
  assetId: id.optional(),
  kind: z.enum(['video', 'image', 'audio', 'text', 'shape', 'adjustment']),
  start: sec,
  duration: sec,
  in: sec,
  transform: z.object({
    x: z.number(),
    y: z.number(),
    scale: z.number().positive(),
    rotation: z.number(),
    opacity: z.number().min(0).max(1),
    crop: z.object({ l: sec, t: sec, r: sec, b: sec }).optional(),
  }),
  text: z
    .object({
      content: z.string(),
      style: textStyleIdSchema,
      words: z.array(z.object({ t: sec, d: sec, w: z.string() })).optional(),
    })
    .optional(),
  effects: z.array(effectSchema),
  keyframes: z.array(keyframeSchema),
  mask: z
    .object({
      kind: z.literal('sam'),
      maskAssetId: id,
      invert: z.boolean(),
      feather: sec,
    })
    .optional(),
  speed: z.number().positive(),
  volume: sec.optional(),
  transitionIn: transitionSchema.optional(),
  transitionOut: transitionSchema.optional(),
  locked: z.boolean().optional(),
});
export const trackSchema = z.object({
  id,
  kind: z.enum(['video', 'overlay', 'text', 'audio']),
  name: z.string(),
  muted: z.boolean(),
  hidden: z.boolean(),
  locked: z.boolean(),
  height: z.union([z.literal(48), z.literal(64), z.literal(88)]),
});
export const projectSchema = z.object({
  id,
  version: z.number().int().nonnegative(),
  fps: z.literal(30),
  width: z.union([z.literal(1920), z.literal(1080)]),
  height: z.union([z.literal(1080), z.literal(1920)]),
  duration: sec,
  tracks: z.array(trackSchema),
  clips: z.record(clipSchema),
  markers: z.array(markerSchema),
});
export const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('clip.add'), clip: clipSchema }),
  z.object({
    op: z.literal('clip.update'),
    id,
    patch: clipSchema.partial().omit({ id: true }),
  }),
  z.object({ op: z.literal('clip.remove'), id }),
  z.object({ op: z.literal('clip.move'), id, trackId: id, start: sec }),
  z.object({
    op: z.literal('clip.trim'),
    id,
    edge: z.enum(['in', 'out']),
    value: sec,
  }),
  z.object({ op: z.literal('clip.split'), id, at: sec, newId: id }),
  z.object({ op: z.literal('track.add'), track: trackSchema }),
  z.object({
    op: z.literal('track.update'),
    id,
    patch: trackSchema.partial().omit({ id: true }),
  }),
  z.object({ op: z.literal('text.update'), clipId: id, content: z.string() }),
  z.object({ op: z.literal('effect.set'), clipId: id, effect: effectSchema }),
  z.object({
    op: z.literal('keyframe.set'),
    clipId: id,
    keyframe: keyframeSchema,
  }),
  z.object({ op: z.literal('marker.add'), marker: markerSchema }),
]);
export const uploadRequestSchema = z.object({
  files: z.array(
    z.object({ name: z.string(), size: sec.int().safe(), mime: z.string() }),
  ),
});
export const uploadSchema = z.object({
  assetId: id,
  putUrl: z.string(),
  headers: z.record(z.string()),
  parts: z
    .array(
      z.object({ partNumber: z.number().int().positive(), putUrl: z.string() }),
    )
    .optional(),
});
export const uploadResponseSchema = z.object({
  uploads: z.array(uploadSchema),
});
export const completeRequestSchema = z.object({
  parts: z.array(
    z.object({ partNumber: z.number().int().positive(), etag: z.string() }),
  ),
});
export const sessionRequestSchema = z.object({
  prompt: z.string().max(4000),
  assetIds: z.array(id),
  aspect: z.enum(['16:9', '9:16', '1:1', 'auto']),
  durationHint: z.number().positive().optional(),
});
export const sessionResponseSchema = z.object({
  sessionId: id,
  wsUrl: z.string(),
});
export const sessionSnapshotSchema = z.object({
  status: z.enum([
    'warming',
    'editing',
    'awaiting_review',
    'rendering',
    'done',
    'failed',
  ]),
  project: projectSchema,
  // Unique server-recorded agent.action.start IDs, never inferred from version.
  actionIds: z.array(id).optional(),
  assets: z.array(assetSchema),
  wsUrl: z.string().optional(),
  videoId: id.optional(),
  renderId: id.optional(),
});
export const messageRequestSchema = z.object({
  text: z.string(),
  attachments: z.array(id).optional(),
});
export const opsRequestSchema = z.object({
  ops: z.array(opSchema),
  baseVersion: z.number().int().nonnegative(),
});
export const versionResponseSchema = z.object({
  version: z.number().int().nonnegative(),
});
export const approvalResponseSchema = z.object({ renderId: id });
export const renderSchema = z.object({
  status: z.enum(['queued', 'rendering', 'done', 'failed']),
  progress: z.number().min(0).max(1),
  frame: sec,
  totalFrames: sec,
  etaSec: sec,
  videoId: id.optional(),
});
export const videoSchema = z.object({
  url: z.string(),
  posterUrl: z.string(),
  durationSec: sec,
  width: z.number().positive(),
  height: z.number().positive(),
  sizeBytes: sec,
  title: z.string(),
});
export const serverEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), version: z.number().int().nonnegative() }),
  z.object({
    t: z.literal('agent.status'),
    state: z.enum(['thinking', 'acting', 'waiting_user', 'idle']),
    label: z.string(),
  }),
  z.object({
    t: z.literal('agent.action.start'),
    id,
    tool: z.string(),
    title: z.string(),
    args: z.record(z.unknown()),
    target: z
      .object({
        clipId: id.optional(),
        trackId: id.optional(),
        region: z
          .object({
            x: z.number(),
            y: z.number(),
            w: z.number(),
            h: z.number(),
          })
          .optional(),
      })
      .optional(),
  }),
  z.object({
    t: z.literal('agent.action.progress'),
    id,
    pct: z.number().min(0).max(1).optional(),
    note: z.string().optional(),
  }),
  z.object({
    t: z.literal('agent.action.end'),
    id,
    ok: z.boolean(),
    error: z.string().optional(),
    durationMs: sec,
  }),
  z.object({
    t: z.literal('project.ops'),
    version: z.number().int().nonnegative(),
    ops: z.array(opSchema),
    actionId: id.optional(),
  }),
  z.object({
    t: z.literal('agent.message'),
    id,
    role: z.literal('agent'),
    text: z.string(),
    kind: z.enum(['say', 'ask_review', 'ask_choice']),
    choices: z.array(z.string()).optional(),
  }),
  z.object({ t: z.literal('asset.added'), asset: assetSchema }),
  z.object({
    t: z.literal('sam.mask'),
    clipId: id,
    maskAssetId: id,
    previewPolygon: z.array(z.tuple([z.number(), z.number()])),
  }),
  z.object({
    t: z.literal('warmup.step'),
    step: z.enum(['upload', 'probe', 'watch', 'plan', 'ready']),
    pct: z.number().min(0).max(1),
  }),
  z.object({ t: z.literal('error'), code: z.string(), message: z.string() }),
]);
export const clientEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('interrupt'), text: z.string() }),
  z.object({ t: z.literal('pause') }),
  z.object({ t: z.literal('resume') }),
  z.object({ t: z.literal('ping') }),
]);
export type Asset = z.infer<typeof assetSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Track = z.infer<typeof trackSchema>;
export type KimoProject = z.infer<typeof projectSchema>;
export type Op = z.infer<typeof opSchema>;
export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ClientEvent = z.infer<typeof clientEventSchema>;
export type Upload = z.infer<typeof uploadSchema>;
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;
export type SessionRequest = z.infer<typeof sessionRequestSchema>;
