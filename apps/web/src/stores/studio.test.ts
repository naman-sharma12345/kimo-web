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
