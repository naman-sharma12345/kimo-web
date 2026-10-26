import { create } from 'zustand';
export const useUI = create<{
  reducedMotion: boolean;
  setReducedMotion: (value: boolean) => void;
}>((set) => ({
  reducedMotion: false,
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
}));
