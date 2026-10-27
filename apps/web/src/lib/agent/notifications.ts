export type AttentionRequest = {
  id: string;
  kind: 'ask_review' | 'ask_choice';
};
export type NotificationEnvironment = {
  hidden(): boolean;
  getTitle(): string;
  setTitle(title: string): void;
  permission(): NotificationPermission | 'unavailable';
  requestPermission(): Promise<NotificationPermission>;
  notify(title: string): { close(): void };
  onVisibility(callback: () => void): () => void;
  readDecision(): string | null;
  writeDecision(value: string): void;
};
export type AgentNotificationController = {
  userSent(): void;
  answer(value: 'yes' | 'no thanks'): Promise<void>;
  attention(request: AttentionRequest): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): boolean;
  dispose(): void;
};
const attentionTitle = '(1) kimo needs you';
const decisionKey = 'kimo.agent.notifications';
function browserEnvironment(): NotificationEnvironment {
  const supported = () =>
    typeof window !== 'undefined' && 'Notification' in window;
  return {
    hidden: () => typeof document !== 'undefined' && document.hidden,
    getTitle: () => (typeof document === 'undefined' ? '' : document.title),
    setTitle: (title) => {
      if (typeof document !== 'undefined') document.title = title;
    },
    permission: () =>
      supported() ? window.Notification.permission : 'unavailable',
    requestPermission: () =>
      supported()
        ? window.Notification.requestPermission()
        : Promise.resolve('denied'),
    notify: (title) => new window.Notification(title),
    onVisibility: (callback) => {
      if (typeof document === 'undefined') return () => {};
      document.addEventListener('visibilitychange', callback);
      return () => document.removeEventListener('visibilitychange', callback);
    },
    readDecision: () => {
      try {
        return window.localStorage.getItem(decisionKey);
      } catch {
        return null;
      }
    },
    writeDecision: (value) => {
      try {
        window.localStorage.setItem(decisionKey, value);
      } catch {
        /* Storage is optional, including in private browsing. */
      }
    },
  };
}
/** Create once at shell/session scope, not on each chat mount. */
export function createAgentNotificationController(
  environment: NotificationEnvironment = browserEnvironment(),
): AgentNotificationController {
  let disposed = false;
  let sent = false;
  let asking = false;
  let answered = environment.readDecision() !== null;
  let oldTitle: string | undefined;
  const seen = new Set<string>();
  const notifications = new Set<{ close(): void }>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const getSnapshot = () =>
    !disposed && sent && !answered && environment.permission() === 'default';
  const clear = () => {
    if (oldTitle !== undefined && environment.getTitle() === attentionTitle)
      environment.setTitle(oldTitle);
    oldTitle = undefined;
    notifications.forEach((notification) => {
      try {
        notification.close();
      } catch {
        /* Browser may already have closed it. */
      }
    });
    notifications.clear();
  };
  const unsubscribe = environment.onVisibility(() => {
    if (!disposed && !environment.hidden()) clear();
  });
  return {
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    userSent: () => {
      if (disposed) return;
      sent = true;
      emit();
    },
    answer: async (value) => {
      if (disposed || !sent || answered || asking) return;
      asking = true;
      answered = true;
      environment.writeDecision(value);
      emit();
      if (value === 'yes' && environment.permission() === 'default') {
        try {
          await environment.requestPermission();
        } catch {
          /* No permission is not a notification delivery failure. */
        }
      }
      asking = false;
      if (!disposed) emit();
    },
    attention: (request) => {
      if (disposed || seen.has(request.id)) return;
      seen.add(request.id);
      if (!environment.hidden()) return;
      if (oldTitle === undefined) oldTitle = environment.getTitle();
      environment.setTitle(attentionTitle);
      if (environment.permission() === 'granted') {
        try {
          notifications.add(
            environment.notify('kimo · your first cut is ready'),
          );
        } catch {
          /* Title attention remains available if construction fails. */
        }
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      clear();
      emit();
      listeners.clear();
      seen.clear();
    },
  };
}
