import { z } from 'zod';
import { opSchema, projectSchema } from '@kimo/client';

const version = z.number().int().nonnegative().safe();
export const strictEditGuardSchema = z
  .object({
    sessionId: z.string().min(1),
    projectId: z.string().min(1),
    version,
    projectIdentity: z.string().min(1),
    assetsIdentity: z.string().min(1),
    opsIdentity: z.string().min(1),
  })
  .strict();
/** Canonical JSON content identity, not a cryptographic authentication claim. */
export function editIdentity(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(editIdentity).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${editIdentity(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const groups = z.array(
  z.object({
    id: z.string().min(1),
    label: z.string(),
    source: z.enum([
      'timeline',
      'inspector',
      'viewer',
      'captions',
      'keyboard',
      'history',
      'assets',
    ]),
    ops: z.array(opSchema),
    status: z.enum(['unsent', 'failed', 'unknown']),
    baseVersion: version.optional(),
    acceptedVersion: version.optional(),
    strictGuard: strictEditGuardSchema.optional(),
    intentBaseline: projectSchema.optional(),
    intentOps: z.array(opSchema).optional(),
  }),
);
export const legacyOutboxSchema = z.object({
  format: z.literal(1),
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  baseVersion: version,
  groups,
});
export const editOutboxSchema = legacyOutboxSchema.extend({
  format: z.literal(2),
});
export type EditOutboxRecord = z.infer<typeof editOutboxSchema>;
export interface EditOutboxIdentity {
  sessionId: string;
  projectId: string;
}
export interface EditOutboxBinding {
  readonly record: EditOutboxRecord | null;
  save(record: EditOutboxRecord): Promise<void>;
  close(): Promise<void>;
}
export interface EditOutboxPersistence {
  open(
    identity: EditOutboxIdentity,
    options: {
      signal: AbortSignal;
      legacyStorage?: Pick<Storage, 'getItem' | 'removeItem'>;
      onUnavailable: (error: Error) => void;
    },
  ): Promise<EditOutboxBinding>;
}
export class EditPersistenceError extends Error {
  constructor(
    readonly status: 'locked' | 'unavailable' | 'unreadable',
    message: string,
  ) {
    super(message);
    this.name = 'EditPersistenceError';
  }
}
export function legacyOutboxKey(identity: EditOutboxIdentity): string {
  return `kimo:editing:1:${encodeURIComponent(identity.sessionId)}:${encodeURIComponent(identity.projectId)}`;
}
export function validateOutbox(
  value: unknown,
  identity: EditOutboxIdentity,
): EditOutboxRecord {
  const record = editOutboxSchema.parse(value);
  if (
    record.sessionId !== identity.sessionId ||
    record.projectId !== identity.projectId
  )
    throw new Error('Stored edits do not match this session');
  if (
    new Set(record.groups.map((group) => group.id)).size !==
    record.groups.length
  )
    throw new Error('Stored edit IDs must be unique');
  if (
    record.groups.some(
      (group) =>
        group.intentBaseline && group.intentBaseline.id !== identity.projectId,
    )
  )
    throw new Error('Stored intent belongs to another project');
  if (
    record.groups.some(
      (group) =>
        (group.intentBaseline === undefined) !==
        (group.intentOps === undefined),
    )
  )
    throw new Error('Stored intent must include both baseline and operations');
  for (const group of record.groups) {
    const guard = group.strictGuard;
    if (
      guard &&
      (guard.sessionId !== identity.sessionId ||
        guard.projectId !== identity.projectId ||
        guard.opsIdentity !== editIdentity(group.ops) ||
        group.intentBaseline)
    )
      throw new Error(
        'Stored strict guard does not match its payload or session',
      );
  }
  return record;
}
