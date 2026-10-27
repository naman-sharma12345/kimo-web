import { describe, expect, it } from 'vitest';
import { fixture, assets, memoryStorage } from '@/lib/editing/test-fixtures';
import {
  createCutStore,
  projectBeats,
  snapToBeat,
  captionCues,
  serializeSrt,
  exportAvailable,
  rememberPrompt,
  matchesQuery,
} from './index';
describe('device-local immutable cuts', () => {
  it('deduplicates actual review identities across reload and freezes nested values', () => {
    const storage = memoryStorage();
    const store = createCutStore(storage);
    const project = fixture();
    const cut = store.capture({
      sessionId: 's',
      requestId: 'review1',
      project,
      assets,
      createdAt: 1,
    });
    if (project.clips.t.text) project.clips.t.text.content = 'changed';
    expect(cut.project.clips.t?.text?.content).toBe('hello world');
    expect(Object.isFrozen(cut.project.clips)).toBe(true);
    const restored = createCutStore(storage);
    expect(
      restored.capture({
        sessionId: 's',
        requestId: 'review1',
        project,
        assets,
        createdAt: 2,
      }).label,
    ).toBe('cut 1');
    expect(
      restored.capture({
        sessionId: 's',
        requestId: 'review2',
        project,
        assets,
        createdAt: 2,
      }).label,
    ).toBe('cut 2');
    expect(restored.list('other')).toEqual([]);
  });
  it('reports storage denial honestly without losing this-session snapshot', () => {
    const store = createCutStore({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    store.capture({
      sessionId: 's',
      requestId: 'r',
      project: fixture(),
      assets,
      createdAt: 1,
    });
    expect(store.persistent).toBe(false);
    expect(store.list('s')).toHaveLength(1);
  });
  it('does not overwrite malformed persisted data', () => {
    const storage = memoryStorage();
    storage.setItem('kimo-local-cuts:v1', 'corrupt');
    const store = createCutStore(storage);
    store.capture({
      sessionId: 's',
      requestId: 'r',
      project: fixture(),
      assets,
      createdAt: 1,
    });
    expect(storage.getItem('kimo-local-cuts:v1')).toBe('corrupt');
    expect(store.persistent).toBe(false);
  });
});
describe('actual beat projection', () => {
  it('projects only explicit music source detections using trim and speed', () => {
    const p = fixture();
    p.clips.c.audioRole = 'music';
    p.clips.c.start = 5;
    p.clips.c.in = 2;
    p.clips.c.speed = 2;
    const beats = projectBeats(p, [
      {
        assetId: 'a',
        sourceTimes: [1, 2, 4, 4, 10, NaN],
        provenance: 'producer-detected',
      },
    ]);
    expect(beats.map((b) => b.time)).toEqual([5, 6]);
    expect(snapToBeat(6.05, beats, 100)).toEqual({ time: 6, guide: 6 });
    expect(snapToBeat(6.1, beats, 100)).toEqual({ time: 6.1 });
    expect(
      projectBeats(fixture(), [
        { assetId: 'a', sourceTimes: [2], provenance: 'producer-detected' },
      ]),
    ).toEqual([]);
    expect(projectBeats(p, [])).toEqual([]);
  });
  it('resolves ties to earlier beat and rejects invalid zoom', () => {
    const beats = [1, 2].map((time) => ({ time, clipId: 'c', trackId: 'a' }));
    expect(snapToBeat(1.5, beats, 8).time).toBe(1);
    expect(snapToBeat(1.5, beats, 0).guide).toBeUndefined();
  });
});
describe('actual caption timing to SRT', () => {
  it('uses classified clip intervals, not fabricated word alignment', () => {
    const cues = captionCues(fixture());
    expect(cues).toEqual([{ start: 0, end: 4, text: 'hello world' }]);
    expect(serializeSrt(cues)).toBe(
      '1\n00:00:00,000 --> 00:00:04,000\nhello world\n',
    );
  });
  it('preserves overlapping cues, sanitizes markup and empty separators, rounds across hour', () => {
    const result = serializeSrt([
      { start: 3599.9996, end: 3601, text: '<b>&\r\n\r\nhi' },
      { start: 0, end: 2, text: 'one' },
      { start: 1, end: 3, text: 'two' },
      { start: NaN, end: 2, text: 'bad' },
    ]);
    expect(result).toContain(
      '01:00:00,000 --> 01:00:01,000\n&lt;b&gt;&amp;\nhi',
    );
    expect(result).toContain('00:00:01,000 --> 00:00:03,000');
    expect(serializeSrt([{ start: 1, end: 1, text: 'invalid' }])).toBe('');
  });
});
describe('honest export and command models', () => {
  it('requires explicit producer capabilities for every nondefault export', () => {
    const no = { resolution720: false, webm: false, dualPortrait: false };
    expect(
      exportAvailable(
        { resolution: '1080p', format: 'mp4', alsoPortrait: false },
        no,
      ),
    ).toBe(true);
    expect(
      exportAvailable(
        { resolution: '720p', format: 'webm', alsoPortrait: true },
        no,
      ),
    ).toBe(false);
  });
  it('searches all words and keeps prompts local, deduplicated, bounded', () => {
    expect(matchesQuery('add text at playhead', 'text add')).toBe(true);
    const storage = memoryStorage();
    rememberPrompt(storage, 'hello');
    expect(rememberPrompt(storage, 'hello')).toEqual(['hello']);
    for (let index = 0; index < 30; index++)
      rememberPrompt(storage, String(index));
    expect(rememberPrompt(storage, '')).toHaveLength(20);
  });
});
