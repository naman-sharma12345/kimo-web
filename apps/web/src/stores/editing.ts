import { create } from 'zustand';
import {
  createEditingSession,
  type EditContext,
  type EditingAPI,
  type EditState,
} from '@/lib/editing';
interface EditingStore {
  session: EditingAPI | null;
  state: EditState | null;
  connect(context: EditContext): EditingAPI;
  disconnect(): void;
}
let closing: Promise<void> = Promise.resolve();
let unsubscribe: (() => void) | undefined;
export const useEditing = create<EditingStore>((set, get) => ({
  session: null,
  state: null,
  connect(context) {
    get().disconnect();
    const session = createEditingSession({
      ...context,
      persistenceReadyAfter: Promise.all([
        closing,
        context.persistenceReadyAfter ?? Promise.resolve(),
      ]).then(() => undefined),
    });
    unsubscribe = session.subscribe((state) => set({ state }));
    set({ session, state: session.getState() });
    return session;
  },
  disconnect() {
    unsubscribe?.();
    unsubscribe = undefined;
    const previous = get().session;
    if (previous) {
      previous.dispose();
      closing = Promise.all([closing, previous.closed()]).then(() => undefined);
    }
    set({ session: null, state: null });
  },
}));
