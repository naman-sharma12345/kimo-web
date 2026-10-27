import { create } from 'zustand';
import type { KimoProject, Op } from '@kimo/client';
import { api } from '@/lib/api';
import type { EditContext, EditingAPI } from '@/lib/editing';
import { useEditing } from './editing';

let activeId: string | null = null;
function browserStorage(): EditContext['storage'] {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
interface ProjectStore {
  /** Display projection, including pending optimistic edits and draft. Never an ACK clock. */
  project: KimoProject | null;
  acknowledgedVersion: number;
  replace(project: KimoProject): void;
  receive(id: string, version: number, ops: Op[]): Promise<void>;
  edit(id: string, ops: Op[]): Promise<void>;
  /** Parent installs notifications/assets and its ONE socket via this structural seam. */
  attach(context: EditContext): EditingAPI;
  dispose(): void;
}
export const useProject = create<ProjectStore>((set, get) => {
  function attach(context: EditContext) {
    activeId = context.sessionId;
    const session = useEditing.getState().connect({
      ...context,
      projectChanged(project) {
        set({
          project,
          acknowledgedVersion:
            useEditing.getState().session?.getState().acknowledgedVersion ??
            project.version,
        });
        context.projectChanged?.(project);
      },
    });
    set({
      project: session.getState().project,
      acknowledgedVersion: session.getState().acknowledgedVersion,
    });
    return session;
  }
  function ensure(id: string) {
    const existing = useEditing.getState().session;
    if (existing && activeId === id) return existing;
    const project = get().project;
    if (!project) throw new Error('Project is unavailable');
    return attach({
      sessionId: id,
      project,
      client: api,
      storage: browserStorage(),
      online: () => typeof navigator === 'undefined' || navigator.onLine,
    });
  }
  return {
    project: null,
    acknowledgedVersion: 0,
    attach,
    replace(project) {
      const session = useEditing.getState().session;
      if (session && session.getState().acknowledged.id === project.id) {
        session.replaceSnapshot({
          project,
          assets: [...session.getState().assets],
        });
      } else {
        useEditing.getState().disconnect();
        activeId = null;
        set({ project, acknowledgedVersion: project.version });
      }
    },
    async receive(id, version, ops) {
      await ensure(id).receiveAuthoritative({ version, ops });
    },
    async edit(id, ops) {
      if (!get().project) return;
      const result = await ensure(id).editGroup(ops, 'edit', 'inspector');
      if (result.status === 'failed' || result.status === 'unknown')
        throw new Error(result.error ?? 'Edit is not confirmed');
    },
    dispose() {
      useEditing.getState().disconnect();
      activeId = null;
      set({ project: null, acknowledgedVersion: 0 });
    },
  };
});
