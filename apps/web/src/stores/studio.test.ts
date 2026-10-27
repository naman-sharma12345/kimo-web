import { beforeEach, describe, expect, it } from 'vitest';
import { useStudio } from './studio';
beforeEach(() => useStudio.getState().resetSession('s', 10, false, false));
describe('Studio compositor intent state', () => {
  it('has default enabled local scrub audio and exact-release revisions', () => {
    const s = useStudio.getState();
    expect(s.scrubAudioEnabled).toBe(true);
    s.beginScrubbing();
    expect(useStudio.getState().scrubbing).toBe(true);
    s.updateScrubbing(3.1);
    const revision = useStudio.getState().seekRevision;
    s.endScrubbing(3.15);
    expect(useStudio.getState()).toMatchObject({
      scrubbing: false,
      playhead: 3.15,
      seekRevision: revision + 1,
    });
  });
  it('does not confuse throttled playback publications with manual seeks', () => {
    useStudio.getState().publishPlayback(2, true, 50);
    expect(useStudio.getState().seekRevision).toBe(0);
    useStudio.getState().seek(3);
    expect(useStudio.getState().seekRevision).toBe(1);
  });
  it('clamps manual seeks and clears transient fullscreen/scrub state across sessions', () => {
    useStudio.getState().seek(20);
    expect(useStudio.getState().playhead).toBe(10);
    useStudio.getState().seek(NaN);
    expect(useStudio.getState().playhead).toBe(10);
    useStudio.setState({ fullscreen: true, scrubbing: true });
    useStudio.getState().resetSession('next', 5, true, false);
    expect(useStudio.getState()).toMatchObject({
      fullscreen: false,
      scrubbing: false,
      seekRevision: 0,
    });
  });
});

describe('single foreground agent presence', () => {
  it('retains actual start identity and ignores an older end event', () => {
    const receive = useStudio.getState().receive;
    receive({
      t: 'agent.action.start',
      id: 'one',
      tool: 'trim_clip',
      title: 'trimming beach',
      args: {},
      target: { clipId: 'beach', time: 2 },
    });
    expect(useStudio.getState().activeAction).toMatchObject({
      id: 'one',
      target: { clipId: 'beach' },
    });
    receive({
      t: 'agent.action.start',
      id: 'two',
      tool: 'move_clip',
      title: 'moving lake',
      args: {},
      target: { clipId: 'lake' },
    });
    receive({ t: 'agent.action.end', id: 'one', ok: true, durationMs: 100 });
    expect(useStudio.getState().activeAction?.id).toBe('two');
    receive({ t: 'agent.action.end', id: 'two', ok: true, durationMs: 100 });
    expect(useStudio.getState().activeAction).toBeNull();
  });
  it('keeps real status copy and resets foreground state across sessions', () => {
    useStudio.getState().receive({
      t: 'agent.status',
      state: 'thinking',
      label: 'reading your note',
    });
    expect(useStudio.getState().agentLabel).toBe('reading your note');
    useStudio.getState().resetSession('new', 12, false, false);
    expect(useStudio.getState()).toMatchObject({
      activeAction: null,
      agentLabel: '',
    });
  });
});

it('does not let a replayed historical start replace the current foreground', () => {
  const receive = useStudio.getState().receive;
  const first = {
    t: 'agent.action.start' as const,
    id: 'old',
    tool: 'trim_clip',
    title: 'old title',
    args: {},
    target: { clipId: 'old-clip' },
  };
  receive(first);
  receive({
    ...first,
    id: 'current',
    title: 'current title',
    target: { clipId: 'current-clip' },
  });
  receive(first);
  expect(useStudio.getState().activeAction?.id).toBe('current');
});

it('keeps the explicit synthetic pause status resumable without inventing a wire paused enum', () => {
  useStudio
    .getState()
    .receive({ t: 'agent.status', state: 'idle', label: 'paused' });
  expect(useStudio.getState().agent).toBe('paused');
  useStudio
    .getState()
    .receive({ t: 'agent.status', state: 'thinking', label: 'planning' });
  expect(useStudio.getState().agent).toBe('thinking');
});
