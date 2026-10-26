import { describe, it, expect } from 'vitest';
import {
  aggregateUploadProgress,
  initialWarmupState,
  warmupEvent,
} from './state';
describe('honest warmup state', () => {
  it('maps probe to watch and never moves backwards on duplicate events', () => {
    const watch = warmupEvent(initialWarmupState, {
      t: 'warmup.step',
      step: 'probe',
      pct: 0.2,
    });
    expect(watch.step).toBe('watch');
    expect(
      warmupEvent(watch, { t: 'warmup.step', step: 'upload', pct: 1 }),
    ).toEqual(watch);
  });
  it('does not invent readiness from ordinary status labels', () => {
    const state = warmupEvent(initialWarmupState, {
      t: 'agent.status',
      state: 'acting',
      label: 'found speech',
    });
    expect(state.step).toBe('upload');
    expect(state.noticed).toBe('found speech');
  });
  it('opens only on real ready or action-start events', () => {
    expect(
      warmupEvent(initialWarmupState, {
        t: 'agent.action.start',
        id: 'a',
        tool: 'cut',
        title: 'cut',
        args: {},
      }).step,
    ).toBe('ready');
  });
  it('weights upload progress by bytes rather than file count', () => {
    expect(
      aggregateUploadProgress([
        { file: { size: 900 }, bytesSent: 450, status: 'uploading' },
        { file: { size: 100 }, bytesSent: 100, status: 'done' },
      ]),
    ).toBe(0.55);
    expect(aggregateUploadProgress([])).toBe(1);
  });
  it('retains the server error message', () => {
    expect(
      warmupEvent(initialWarmupState, {
        t: 'error',
        code: 'failed',
        message: 'file unavailable',
      }).error,
    ).toBe('file unavailable');
  });
});
