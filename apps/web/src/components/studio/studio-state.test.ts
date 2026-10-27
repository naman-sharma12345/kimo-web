import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampPanel,
  readPreferences,
  responsiveSizes,
  useStudio,
} from '@/stores/studio';
import { timecode } from './transport';
beforeEach(() => {
  localStorage.clear();
  useStudio.getState().resetSession('s', 45, false, false);
  useStudio.setState({
    sizes: {},
    agentCollapsed: false,
    inspectorCollapsed: false,
    timelineCollapsed: false,
  });
});
describe('studio shell state', () => {
  it('uses exact breakpoint defaults and clamps panel sizes', () => {
    expect(responsiveSizes(1920)).toEqual({
      agent: 360,
      inspector: 320,
      timeline: 320,
    });
    expect(responsiveSizes(1599)).toEqual({
      agent: 320,
      inspector: 280,
      timeline: 280,
    });
    expect(responsiveSizes(1280).agent).toBe(320);
    expect(responsiveSizes(1279).agent).toBe(300);
    expect(clampPanel('agent', 10, 1080)).toBe(300);
    expect(clampPanel('agent', 1000, 1080)).toBe(480);
    expect(clampPanel('inspector', 1000, 1080)).toBe(420);
    expect(clampPanel('timeline', 1000, 900)).toBe(540);
    expect(clampPanel('timeline', 10, 900)).toBe(200);
    expect(clampPanel('agent', NaN, 900)).toBe(360);
  });
  it('persists layout per user with a versioned key', () => {
    useStudio.setState({ sizes: { agent: 420, timeline: 240 } });
    useStudio.getState().togglePanel('agent');
    useStudio.getState().persist('alice');
    expect(readPreferences('alice')).toEqual({
      sizes: { agent: 420, timeline: 240 },
      agentCollapsed: true,
      inspectorCollapsed: false,
      timelineCollapsed: false,
    });
    expect(readPreferences('bob').sizes).toEqual({});
    localStorage.setItem('kimo-studio:v1:bob', '{broken');
    expect(readPreferences('bob').agentCollapsed).toBe(false);
    localStorage.setItem(
      'kimo-studio:v1:bob',
      JSON.stringify({
        sizes: { agent: '480', inspector: 300 },
        agentCollapsed: 'yes',
      }),
    );
    expect(readPreferences('bob')).toMatchObject({
      sizes: { inspector: 300 },
      agentCollapsed: false,
    });
  });
  it('survives storage denial without losing live layout', () => {
    const get = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });
    expect(readPreferences('u').sizes).toEqual({});
    get.mockRestore();
    const set = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });
    useStudio.setState({ sizes: { agent: 400 } });
    expect(() => useStudio.getState().persist('u')).not.toThrow();
    expect(useStudio.getState().sizes.agent).toBe(400);
    set.mockRestore();
  });
  it('deduplicates action ids, drives states and records review without inventing prior actions', () => {
    const receive = useStudio.getState().receive;
    receive({ t: 'hello', version: 10 });
    receive({ t: 'agent.status', state: 'thinking', label: '' });
    expect(useStudio.getState()).toMatchObject({
      agent: 'thinking',
      wsVersion: 10,
      actionIds: [],
      previewFps: null,
      latencyMs: null,
    });
    useStudio.setState({ agentCollapsed: true });
    const action = {
      t: 'agent.action.start',
      id: 'a',
      tool: 'cut',
      title: 'cutting',
      args: {},
    } as const;
    receive(action);
    receive(action);
    expect(useStudio.getState()).toMatchObject({
      agent: 'acting',
      actionIds: ['a'],
      unread: true,
    });
    receive({ t: 'project.ops', version: 1, ops: [] });
    receive({
      t: 'agent.message',
      id: 'm',
      role: 'agent',
      text: 'review',
      kind: 'ask_review',
    });
    expect(useStudio.getState()).toMatchObject({
      reviewRequested: true,
      agent: 'waiting_user',
      hasOps: true,
    });
    useStudio.getState().resetSession('new', 0, false, false);
    expect(useStudio.getState()).toMatchObject({
      actionIds: [],
      reviewRequested: false,
      hasOps: false,
      selection: [],
    });
  });
  it('clamps transport intent and formats real frame timecodes', () => {
    useStudio.getState().seek(-1);
    expect(useStudio.getState().playhead).toBe(0);
    useStudio.getState().seek(100);
    expect(useStudio.getState().playhead).toBe(45);
    expect(timecode(12 + 7 / 30)).toBe('00:00:12:07');
    expect(timecode(3661)).toBe('01:01:01:00');
  });
});

describe('preview readiness and legacy intent', () => {
  it('blocks playback in every non-ready renderer state without blocking manual seek or accepting stale publications', () => {
    for (const status of ['initializing', 'unavailable', 'error'] as const) {
      useStudio.getState().setPreviewStatus(status);
      useStudio.getState().requestPlayback(true, -1);
      useStudio.getState().seek(7);
      useStudio.getState().publishPlayback(9, true, 60);
      expect(useStudio.getState()).toMatchObject({
        playing: false,
        shuttle: 0,
        playhead: 7,
        previewFps: null,
      });
    }
    useStudio.getState().setPreviewStatus('ready');
    useStudio.getState().requestPlayback(true, 1);
    expect(useStudio.getState()).toMatchObject({ playing: true, shuttle: 1 });
    useStudio.getState().resetSession('next', 10, false, false);
    expect(useStudio.getState()).toMatchObject({
      previewStatus: 'legacy',
      playing: false,
      shuttle: 0,
    });
    useStudio.getState().requestPlayback(true);
    expect(useStudio.getState().playing).toBe(true);
  });
});
