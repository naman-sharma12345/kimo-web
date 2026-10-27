import { z } from 'zod';
import {
  projectSchema,
  assetSchema,
  type KimoProject,
  type Asset,
} from '@kimo/client';
import { isCaptionClip } from '@/components/studio/text-editing/caption-commands';

export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
export type LocalCut = DeepReadonly<{
  id: string;
  sessionId: string;
  requestId: string;
  label: string;
  ordinal: number;
  createdAt: number;
  project: KimoProject;
  assets: Asset[];
}>;
export type LocalStorage = Pick<Storage, 'getItem' | 'setItem'>;
const key = 'kimo-local-cuts:v1';
const cutSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  requestId: z.string(),
  label: z.string(),
  ordinal: z.number().int().positive(),
  createdAt: z.number().finite().nonnegative(),
  project: projectSchema,
  assets: z.array(assetSchema),
});
function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((child: unknown) => freeze(child));
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
export function createCutStore(storage?: LocalStorage) {
  let persistent = !!storage;
  let safeToWrite = true;
  let cuts: LocalCut[] = [];
  try {
    const raw = storage?.getItem(key);
    if (raw) {
      const parsed = z.array(cutSchema).parse(JSON.parse(raw) as unknown);
      const ids = new Set<string>();
      for (const cut of parsed) {
        const identity = JSON.stringify([cut.sessionId, cut.requestId]);
        if (ids.has(identity) || cut.label !== `cut ${cut.ordinal}`)
          throw new Error('invalid cuts');
        ids.add(identity);
      }
      cuts = parsed.map((cut) => freeze(cut));
    }
  } catch {
    persistent = false;
    safeToWrite = false;
  }
  return {
    get persistent() {
      return persistent;
    },
    list(sessionId: string): readonly LocalCut[] {
      return Object.freeze(cuts.filter((cut) => cut.sessionId === sessionId));
    },
    capture(input: {
      sessionId: string;
      requestId: string;
      project: KimoProject;
      assets: readonly Asset[];
      createdAt: number;
    }): LocalCut {
      const previous = cuts.find(
        (cut) =>
          cut.sessionId === input.sessionId &&
          cut.requestId === input.requestId,
      );
      if (previous) return previous;
      if (!input.sessionId || !input.requestId)
        throw new Error('review identity is required');
      const ordinal =
        Math.max(
          0,
          ...cuts
            .filter((cut) => cut.sessionId === input.sessionId)
            .map((cut) => cut.ordinal),
        ) + 1;
      const cut = freeze(
        cutSchema.parse(
          structuredClone({
            ...input,
            id: JSON.stringify([input.sessionId, input.requestId]),
            label: `cut ${ordinal}`,
            ordinal,
          }),
        ),
      );
      cuts = [...cuts, cut];
      if (safeToWrite && storage) {
        try {
          storage.setItem(key, JSON.stringify(cuts));
        } catch {
          persistent = false;
          safeToWrite = false;
        }
      }
      return cut;
    },
  };
}
export interface FinishCommand {
  id: string;
  label: string;
  disabledReason?: string;
  run: () => void;
}
export function matchesQuery(label: string, query: string): boolean {
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .every((word) => label.toLocaleLowerCase().includes(word));
}
export function rememberPrompt(
  storage: LocalStorage | undefined,
  text: string,
): readonly string[] {
  const prompt = text.trim();
  let previous: string[] = [];
  try {
    previous = z
      .array(z.string())
      .parse(
        JSON.parse(
          storage?.getItem('kimo-recent-prompts:v1') ?? '[]',
        ) as unknown,
      );
  } catch {
    /* Local history is optional. */
  }
  const next = (
    prompt ? [prompt, ...previous.filter((item) => item !== prompt)] : previous
  ).slice(0, 20);
  try {
    storage?.setItem('kimo-recent-prompts:v1', JSON.stringify(next));
  } catch {
    /* Session fallback returned. */
  }
  return next;
}
export interface BeatDetection {
  assetId: string;
  sourceTimes: readonly number[];
  provenance: 'producer-detected';
}
export interface ProjectBeat {
  clipId: string;
  trackId: string;
  time: number;
}
export function projectBeats(
  project: KimoProject,
  detections: readonly BeatDetection[],
): readonly ProjectBeat[] {
  return Object.values(project.clips)
    .flatMap((clip) => {
      if (
        clip.audioRole !== 'music' ||
        !clip.assetId ||
        clip.speed <= 0 ||
        !['audio', 'video'].includes(clip.kind)
      )
        return [];
      return [
        ...new Set(
          detections
            .filter(
              (item) =>
                item.assetId === clip.assetId &&
                item.provenance === 'producer-detected',
            )
            .flatMap((item) => [...item.sourceTimes]),
        ),
      ]
        .filter(
          (time) =>
            Number.isFinite(time) &&
            time >= clip.in &&
            time < clip.in + clip.duration * clip.speed,
        )
        .map((time) => ({
          clipId: clip.id,
          trackId: clip.trackId,
          time: clip.start + (time - clip.in) / clip.speed,
        }));
    })
    .sort((a, b) => a.time - b.time || a.clipId.localeCompare(b.clipId));
}
export function snapToBeat(
  value: number,
  beats: readonly ProjectBeat[],
  zoom: number,
): { time: number; guide?: number } {
  if (!Number.isFinite(value) || !Number.isFinite(zoom) || zoom <= 0)
    return { time: value };
  const target = beats
    .map((beat) => beat.time)
    .filter(Number.isFinite)
    .sort((a, b) => Math.abs(a - value) - Math.abs(b - value) || a - b)[0];
  return target !== undefined && Math.abs(target - value) <= 8 / zoom + 1e-9
    ? { time: target, guide: target }
    : { time: value };
}
export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}
export function captionCues(project: KimoProject): readonly CaptionCue[] {
  return Object.values(project.clips)
    .filter(
      (clip) =>
        isCaptionClip(clip) &&
        !project.tracks.find((track) => track.id === clip.trackId)?.hidden,
    )
    .map((clip) => ({
      start: clip.start,
      end: clip.start + clip.duration,
      text: clip.text?.content ?? '',
    }))
    .filter(validCue)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}
function validCue(cue: CaptionCue): boolean {
  return (
    Number.isFinite(cue.start) &&
    Number.isFinite(cue.end) &&
    cue.start >= 0 &&
    Math.round(cue.end * 1000) > Math.round(cue.start * 1000) &&
    !!cue.text.trim()
  );
}
function stamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
export function serializeSrt(cues: readonly CaptionCue[]): string {
  return [...cues]
    .filter(validCue)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map(
      (cue, index) =>
        `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text
          .replace(/\r\n?/gu, '\n')
          .replace(/\n\s*\n/gu, '\n')
          .replace(/&/gu, '&amp;')
          .replace(/</gu, '&lt;')
          .replace(/>/gu, '&gt;')}\n`,
    )
    .join('\n');
}
export interface ExportSelection {
  resolution: '1080p' | '720p';
  format: 'mp4' | 'webm';
  alsoPortrait: boolean;
}
export interface ExportCapabilities {
  resolution720: boolean;
  webm: boolean;
  dualPortrait: boolean;
}
export function exportAvailable(
  value: ExportSelection,
  capabilities: ExportCapabilities,
): boolean {
  return (
    (value.resolution === '1080p' || capabilities.resolution720) &&
    (value.format === 'mp4' || capabilities.webm) &&
    (!value.alsoPortrait || capabilities.dualPortrait)
  );
}

/** Detached values for the parent sole-controller preview override, never live authority. */
export function cutPreviewState(cut: LocalCut): {
  project: KimoProject;
  assets: Asset[];
} {
  return {
    project: projectSchema.parse(cut.project),
    assets: z.array(assetSchema).parse(cut.assets),
  };
}
