import type { Clip, KimoProject, Op } from '@kimo/client';
import type { InspectorEditorProps } from './types';
export interface Scope {
  props: InspectorEditorProps;
  clip: Clip;
  disabled: boolean;
  acting(property: string): boolean;
  report(message: string): void;
  edit(label: string, build: (project: KimoProject) => readonly Op[]): void;
}
export function patchClip(clip: Clip, patch: Partial<Omit<Clip, 'id'>>): Op {
  return { op: 'clip.update', id: clip.id, patch };
}
export function currentClip(project: KimoProject, id: string): Clip {
  const clip = project.clips[id];
  if (!clip) throw new Error('The selected clip is no longer available.');
  if (clip.locked || project.tracks.find((t) => t.id === clip.trackId)?.locked)
    throw new Error('This clip is locked.');
  return clip;
}
