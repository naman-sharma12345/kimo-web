import type { ServerEvent } from '@kimo/client';
export type WarmupStep = 'upload' | 'watch' | 'plan' | 'ready';
export const warmupSteps: readonly WarmupStep[] = [
  'upload',
  'watch',
  'plan',
  'ready',
];
export const warmupTiming = {
  typedCharacter: 18,
  waveSeconds: 0.9,
  waveStaggerSeconds: 0.12,
  fallback: 4000,
  slow: 60000,
  beat: 400,
  reconnect: [2000, 4000, 8000],
  unfold: 900,
  crossfade: 220,
} as const;
export interface WarmupState {
  step: WarmupStep;
  progress: number;
  noticed: string;
  error: string | null;
}
export const initialWarmupState: WarmupState = {
  step: 'upload',
  progress: 0,
  noticed: '',
  error: null,
};
export function warmupEvent(
  state: WarmupState,
  event: ServerEvent,
): WarmupState {
  switch (event.t) {
    case 'warmup.step': {
      const step = event.step === 'probe' ? 'watch' : event.step;
      if (warmupSteps.indexOf(step) < warmupSteps.indexOf(state.step))
        return state;
      return { ...state, step, progress: event.pct };
    }
    case 'agent.status':
      return { ...state, noticed: event.label };
    case 'agent.action.start':
      return { ...state, step: 'ready', progress: 1 };
    case 'error':
      return { ...state, error: event.message };
    default:
      return state;
  }
}
export function aggregateUploadProgress(
  items: readonly {
    bytesSent: number;
    file: { size: number };
    status: string;
  }[],
): number {
  const total = items.reduce((sum, item) => sum + item.file.size, 0);
  if (!items.length) return 1;
  if (!total) return items.every((item) => item.status === 'done') ? 1 : 0;
  return Math.min(
    1,
    items.reduce((sum, item) => sum + item.bytesSent, 0) / total,
  );
}
