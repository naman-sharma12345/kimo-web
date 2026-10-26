import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { applyOps, ApiError, type KimoProject, type Op } from '@kimo/client';
import { api } from '@/lib/api';
export const useProject = create<{
  project: KimoProject | null;
  replace: (p: KimoProject) => void;
  receive: (id: string, version: number, ops: Op[]) => Promise<void>;
  edit: (id: string, ops: Op[]) => Promise<void>;
}>()(
  immer((set, get) => ({
    project: null,
    replace: (project) => set({ project }),
    receive: async (id, version, ops) => {
      const p = get().project;
      if (!p || version !== p.version + 1) {
        set({ project: (await api.session(id)).project });
        return;
      }
      set({ project: applyOps(p, ops, version) });
    },
    edit: async (id, ops) => {
      const p = get().project;
      if (!p) return;
      set({ project: applyOps(p, ops) });
      try {
        const result = await api.ops(id, ops, p.version);
        set((state) => {
          if (state.project) state.project.version = result.version;
        });
      } catch (error) {
        const snapshot = await api.session(id);
        if (error instanceof ApiError && error.status === 409) {
          set({ project: applyOps(snapshot.project, ops) });
          try {
            const response = await api.ops(id, ops, snapshot.project.version);
            set((state) => {
              if (state.project) state.project.version = response.version;
            });
          } catch (retryError) {
            set({ project: (await api.session(id)).project });
            throw retryError;
          }
        } else {
          set({ project: snapshot.project });
          throw error;
        }
      }
    },
  })),
);
