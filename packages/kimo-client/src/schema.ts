import { z } from 'zod';
const id = z.string().min(1);
const sec = z.number().finite().nonnegative();
export const attributionSchema = z.object({
  site: z.string(),
  pageUrl: z.string().url(),
  license: z.string().optional(),
});
/** Proposed Phase 6 wire metadata; no decoder or backend agreement implied. */
const unit = z.number().finite().min(0).max(1);
const pixelSize = z.number().int().positive().safe();
export const maskMetadataSchema = z.discriminatedUnion('encoding', [
  z.object({
    encoding: z.literal('rle'),
    width: pixelSize,
    height: pixelSize,
    fps: z.number().finite().positive(),
    timeOrigin: sec.optional(),
    coordinateSpace: z.literal('source_uv'),
    channel: z.literal('luma'),
    payloadUrl: z.string().min(1),
    version: z.literal(1),
  }),
  z.object({
    encoding: z.literal('video'),
    width: pixelSize,
    height: pixelSize,
    fps: z.number().finite().positive(),
    timeOrigin: sec.optional(),
    coordinateSpace: z.literal('source_uv'),
    channel: z.enum(['alpha', 'luma', 'red']),
  }),
  z.object({
    encoding: z.literal('luma_image'),
    width: pixelSize,
    height: pixelSize,
    timeOrigin: sec.optional(),
    coordinateSpace: z.literal('source_uv'),
    channel: z.enum(['alpha', 'luma', 'red']),
  }),
]);
export const maskRleFrameSchema = z
  .object({
    frameIndex: z.number().int().nonnegative().safe(),
    width: pixelSize,
    height: pixelSize,
    counts: z.array(z.number().int().nonnegative().safe()).min(1),
  })
  .superRefine((frame, ctx) => {
    if (
      !Number.isSafeInteger(frame.width * frame.height) ||
      frame.counts.reduce((sum, count) => sum + count, 0) !==
        frame.width * frame.height
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RLE runs must cover exactly width * height pixels',
      });
  });
export const lutMetadataSchema = z.object({
  size: z.literal(64),
  layout: z.literal('tiles_8x8'),
  colorSpace: z.literal('srgb'),
});
export const contentColorSchema = z.tuple([unit, unit, unit, unit]);
export const shapeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rect'),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    radius: sec.optional(),
    fill: contentColorSchema,
    stroke: contentColorSchema.optional(),
    strokeWidth: sec.optional(),
  }),
  z.object({
    kind: z.literal('line'),
    x1: z.number().finite(),
    y1: z.number().finite(),
    x2: z.number().finite(),
    y2: z.number().finite(),
    stroke: contentColorSchema,
    strokeWidth: z.number().finite().positive(),
  }),
]);
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
  mask: maskMetadataSchema.optional(),
  lut: lutMetadataSchema.optional(),
});
/** Pure finite filter bounds shared by wire validation and inspector consumers. */
export const effectParameterBounds: Readonly<
  Record<string, Readonly<Record<string, readonly [number, number]>>>
> = {
  grade: {
    exposure: [-16, 16],
    contrast: [0, 8],
    saturation: [0, 8],
    temperature: [-1, 1],
    temp: [-1, 1],
    tint: [-1, 1],
    lift: [-1, 1],
    gamma: [0.001, 16],
    gain: [0, 16],
    liftR: [-1, 1],
    liftG: [-1, 1],
    liftB: [-1, 1],
    gammaR: [0.001, 16],
    gammaG: [0.001, 16],
    gammaB: [0.001, 16],
    gainR: [0, 16],
    gainG: [0, 16],
    gainB: [0, 16],
  },
  vignette: { strength: [0, 1], inner: [0, 2], outer: [0, 2] },
  grain: { amount: [0, 1], seed: [-16777216, 16777216] },
  sharpen: { amount: [0, 8], radius: [0, 256] },
  blur: { radius: [0, 256], strength: [0, 256], x: [0, 256], y: [0, 256] },
};
export const effectSchema = z
  .object({
    id,
    kind: z.string(),
    params: z.record(z.union([z.string(), z.number().finite(), z.boolean()])),
    enabled: z.boolean().optional(),
    scope: z.enum(['all', 'inside_mask', 'outside_mask']).optional(),
  })
  .superRefine((effect, ctx) => {
    const ranges = effectParameterBounds[effect.kind];
    if (ranges)
      for (const [key, value] of Object.entries(effect.params)) {
        const range = ranges[key];
        if (
          range &&
          (typeof value !== 'number' || value < range[0] || value > range[1])
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['params', key],
            message: 'Effect value is outside supported bounds',
          });
      }
    if (
      effect.kind === 'vignette' &&
      typeof effect.params.inner === 'number' &&
      typeof effect.params.outer === 'number' &&
      effect.params.outer <= effect.params.inner
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['params', 'outer'],
        message: 'Outer radius must exceed inner radius',
      });
  });
export const keyframeSchema = z
  .object({
    property: z.string(),
    time: sec,
    value: z.number().finite(),
    easing: z
      .enum(['linear', 'ease_out', 'ease_in_out', 'hold', 'bezier'])
      .optional(),
    bezier: z
      .tuple([unit, z.number().finite(), unit, z.number().finite()])
      .optional(),
  })
  .superRefine((key, ctx) => {
    if (key.easing === 'bezier' && !key.bezier)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bezier'],
        message: 'Bezier easing requires handles',
      });
    if (key.easing !== 'bezier' && key.bezier)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bezier'],
        message: 'Handles require bezier easing',
      });
  });
export const transitionSchema = z
  .object({
    kind: z.enum(['cut', 'crossfade', 'dip', 'slide', 'zoom_in', 'whip']),
    duration: sec.optional(),
    durationFrames: z.number().int().nonnegative().safe().optional(),
    direction: z.enum(['left', 'right', 'up', 'down']).optional(),
  })
  .superRefine((transition, ctx) => {
    if (
      transition.duration === undefined &&
      transition.durationFrames === undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A transition duration is required',
      });
    if (
      transition.duration !== undefined &&
      transition.durationFrames !== undefined &&
      Math.abs(transition.duration - transition.durationFrames / 30) > 1e-6
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Frame and second durations disagree at project 30 fps',
      });
  });
export const markerSchema = z.object({ id, time: sec, label: z.string() });
export const textStyleIdSchema = z.enum([
  'title',
  'caption',
  'lower_third',
  'caption-clean',
  'caption-pop',
  'caption-box',
  'title-serif',
  'title-bold',
  'lower-third',
  'label-mono',
  'quote',
]);
export const clipSchema = z.object({
  id,
  trackId: id,
  assetId: id.optional(),
  kind: z.enum(['video', 'image', 'audio', 'text', 'shape', 'adjustment']),
  start: sec,
  duration: sec,
  in: sec,
  transform: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    scale: z.number().finite().positive(),
    rotation: z.number().finite(),
    opacity: unit,
    crop: z.object({ l: sec, t: sec, r: sec, b: sec }).optional(),
  }),
  text: z
    .object({
      content: z.string(),
      secondaryContent: z.string().optional(),
      style: textStyleIdSchema,
      fontSize: z.number().finite().positive().optional(),
      alignment: z.enum(['left', 'center', 'right']).optional(),
      color: contentColorSchema.optional(),
      animation: z
        .enum(['none', 'fade', 'rise', 'type on', 'pop words'])
        .optional(),
      position: z.enum(['bottom', 'middle', 'top']).optional(),
      words: z.array(z.object({ t: sec, d: sec, w: z.string() })).optional(),
    })
    .optional(),
  effects: z.array(effectSchema),
  keyframes: z.array(keyframeSchema),
  mask: z
    .object({
      kind: z.literal('sam'),
      mode: z.enum(['selection', 'cutout']).optional(),
      maskAssetId: id,
      invert: z.boolean(),
      feather: sec,
    })
    .optional(),
  shape: shapeSchema.optional(),
  animationOffsetSec: sec.optional(),
  audioRole: z.enum(['voice', 'music', 'other']).optional(),
  speed: z.number().finite().positive(),
  volume: sec.optional(),
  fadeInSec: sec.optional(),
  fadeOutSec: sec.optional(),
  keepPitch: z.boolean().optional(),
  duckUnderVoice: z.boolean().optional(),
  linkGroupId: id.optional(),
  transitionIn: transitionSchema.optional(),
  transitionOut: transitionSchema.optional(),
  locked: z.boolean().optional(),
});
export const trackSchema = z.object({
  id,
  kind: z.enum(['video', 'overlay', 'text', 'audio']),
  name: z.string(),
  muted: z.boolean(),
  solo: z.boolean().optional(),
  hidden: z.boolean(),
  locked: z.boolean(),
  height: z.union([z.literal(48), z.literal(64), z.literal(88)]),
});
export const projectSchema = z
  .object({
    id,
    version: z.number().int().nonnegative(),
    fps: z.literal(30),
    width: z.union([z.literal(1920), z.literal(1080)]),
    height: z.union([z.literal(1080), z.literal(1920)]),
    duration: sec,
    tracks: z.array(trackSchema),
    clips: z.record(clipSchema),
    markers: z.array(markerSchema),
    background: contentColorSchema.optional(),
    notes: z.string().optional(),
  })
  .superRefine((project, ctx) => {
    if (project.width === 1920 && project.height === 1920)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Unsupported project dimensions',
      });
  });
/** Phase 7 proposed dimension policy. Both dimensions must be supplied together. */
export const projectPatchSchema = z
  .object({
    width: z.union([z.literal(1920), z.literal(1080)]).optional(),
    height: z.union([z.literal(1080), z.literal(1920)]).optional(),
    background: contentColorSchema.optional(),
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((patch, ctx) => {
    if (
      (patch.width === undefined) !== (patch.height === undefined) ||
      (patch.width === 1920 && patch.height === 1920)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Supply a supported width/height pair',
      });
  });
export const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('project.update'), patch: projectPatchSchema }),
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
  z.object({ op: z.literal('track.remove'), id }),
  z.object({
    op: z.literal('track.update'),
    id,
    patch: trackSchema.partial().omit({ id: true }),
  }),
  z.object({
    op: z.literal('text.update'),
    clipId: id,
    content: z.string(),
    words: z.array(z.object({ t: sec, d: sec, w: z.string() })).optional(),
    secondaryContent: z.string().optional(),
  }),
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
  title: z.string().optional(),
  editExpiresAt: z.string().datetime().optional(),
});
export const messageRequestSchema = z.object({
  text: z.string(),
  attachments: z.array(id).optional(),
});
export const opsRequestSchema = z.object({
  ops: z.array(opSchema),
  baseVersion: z.number().int().nonnegative(),
  clientMutationId: id.optional(),
});
export const versionResponseSchema = z.object({
  version: z.number().int().nonnegative(),
});
export const approvalOptionsSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    preset: z.literal('1080p').optional(),
    burnInCaptions: z.boolean().optional(),
    expectedProjectVersion: z.number().int().nonnegative().safe().optional(),
  })
  .strict();
export const cancelRenderResponseSchema = z.object({
  status: z.literal('cancelled'),
  sessionId: id,
});
export const reopenSessionResponseSchema = z.object({
  status: z.literal('editing'),
});
export const approvalResponseSchema = z.object({ renderId: id });
export const renderSchema = z.object({
  status: z.enum(['queued', 'rendering', 'done', 'failed', 'cancelled']),
  sessionId: id.optional(),
  error: z.object({ message: z.string() }).optional(),
  fps: z.literal(30).optional(),
  chunkIndex: z.number().int().nonnegative().safe().optional(),
  progress: z.number().min(0).max(1),
  frame: sec,
  totalFrames: sec,
  etaSec: sec,
  videoId: id.optional(),
});
export const videoSchema = z.object({
  sessionId: id.optional(),
  editExpiresAt: z.string().datetime().optional(),
  downloadExpiresAt: z.string().datetime().optional(),
  createdInSec: sec.optional(),
  audio: z
    .object({
      channels: z.number().int().positive().safe(),
      sampleRateHz: z.number().int().positive().safe(),
    })
    .optional(),
  history: z
    .array(
      z.object({
        summary: z.string(),
        stepCount: z.number().int().nonnegative().safe(),
      }),
    )
    .optional(),
  models: z.array(z.string()).optional(),
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
    // Phase 8 proposal: precise synthetic interrupt acknowledgement.
    inReplyTo: id.optional(),
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
        time: sec.optional(),
        previewPolygon: z.array(z.tuple([unit, unit])).optional(),
        subjectLabel: z.string().optional(),
        coordinateSpace: z.literal('source_uv').optional(),
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
    // Phase 8 proposal, not production producer agreement.
    resultSummary: z.string().optional(),
  }),
  z.object({
    t: z.literal('project.ops'),
    version: z.number().int().nonnegative(),
    ops: z.array(opSchema),
    actionId: id.optional(),
    author: z.enum(['user', 'agent']).optional(),
    clientMutationId: id.optional(),
  }),
  z.object({
    t: z.literal('agent.message'),
    id,
    role: z.literal('agent'),
    text: z.string(),
    kind: z.enum(['say', 'ask_review', 'ask_choice']),
    choices: z.array(z.string()).optional(),
    // Cumulative text; increasing sequence within the same message ID.
    stream: z
      .object({
        sequence: z.number().int().nonnegative().safe(),
        done: z.boolean(),
      })
      .optional(),
  }),
  z.object({
    t: z.literal('asset.added'),
    asset: assetSchema,
    actionId: id.optional(),
  }),
  z.object({
    t: z.literal('sam.mask'),
    actionId: id.optional(),
    subjectLabel: z.string().optional(),
    coordinateSpace: z.literal('source_uv').optional(),
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
  z.object({
    t: z.literal('interrupt'),
    text: z.string(),
    clientMessageId: id.optional(),
  }),
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

/** Named Phase 6 resource types for pure decoders/adapters. */
export type MaskMetadata = z.infer<typeof maskMetadataSchema>;
export type MaskRleFrame = z.infer<typeof maskRleFrameSchema>;
export type LutMetadata = z.infer<typeof lutMetadataSchema>;
export type ClipShape = z.infer<typeof shapeSchema>;
export type Keyframe = z.infer<typeof keyframeSchema>;
export type Transition = z.infer<typeof transitionSchema>;
export type TextStyleId = z.infer<typeof textStyleIdSchema>;

export type ApprovalOptions = z.infer<typeof approvalOptionsSchema>;
export type Render = z.infer<typeof renderSchema>;
export type Video = z.infer<typeof videoSchema>;
export type CancelRenderResponse = z.infer<typeof cancelRenderResponseSchema>;
export type ReopenSessionResponse = z.infer<typeof reopenSessionResponseSchema>;
