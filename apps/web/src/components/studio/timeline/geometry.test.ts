import { projectBeats } from '@/lib/studio-finish';
import { describe, expect, it } from 'vitest';
import { deleteClips, trimClip, slipClip } from '@/lib/editing/commands';
import { displayTracks } from '@/lib/editing/display';
import { applyOps } from '@kimo/client';
import {
  validTimelineBeats,
  canvasBounds,
  clampZoom,
  edgeAt,
  fitZoom,
  hitClip,
  linkedSelection,
  majorInterval,
  rowHeight,
  selectClip,
  snapDelta,
  snapTime,
  sourceClock,
  viewportRange,
  visibleClips,
} from './geometry';
import { clip, project, source, track } from './test-fixtures';
describe('timeline geometry and shared edit semantics', () => {
  it('fits 10% padding with header excluded and clamps both scale bounds', () => {
    expect(fitZoom(1260, 10)).toBe(100);
    expect(fitZoom(100, 99999)).toBe(4);
    expect(fitZoom(1260, 0)).toBe(600);
    expect(clampZoom(800)).toBe(600);
  });
  it('chooses nice majors at least 80px apart at every zoom', () => {
    for (const zoom of [4, 5, 20, 40, 80, 300, 600])
      expect(majorInterval(zoom) * zoom).toBeGreaterThanOrEqual(80);
  });
  it('draws only one screen extra on either side without duration-sized allocation', () => {
    expect(viewportRange(1000, 500, 100)).toEqual({ start: 5, end: 20 });
    const clips = [
      clip('left', { start: 0 }),
      clip('visible', { start: 8 }),
      clip('right', { start: 21 }),
    ];
    expect(visibleClips(clips, 1000, 500, 100).map((c) => c.id)).toEqual([
      'visible',
    ]);
    expect(canvasBounds(500, 8)).toEqual({ width: 1500, ratio: 2 });
  });
  it('shares half-open body hit testing and nearest edge geometry', () => {
    const c = clip();
    expect(hitClip([c], 4)?.id).toBe('a');
    expect(hitClip([c], 7)).toBeUndefined();
    expect(edgeAt(c, 4.08, 100)).toBe('in');
    expect(edgeAt(c, 6.95, 100)).toBe('out');
    expect(edgeAt(c, 5, 100)).toBeNull();
  });
  it('keeps display ordering separate from compositor layering', () => {
    const p = project(
      [],
      [
        track('a', 'audio'),
        track('v'),
        track('o', 'overlay'),
        track('t', 'text'),
      ],
    );
    expect(displayTracks(p).map((t) => t.id)).toEqual(['t', 'o', 'v', 'a']);
    expect(p.tracks.map((t) => t.id)).toEqual(['a', 'v', 'o', 't']);
    expect(
      ['text', 'overlay', 'video', 'audio'].map((kind) =>
        rowHeight(kind as ReturnType<typeof track>['kind']),
      ),
    ).toEqual([48, 64, 88, 64]);
  });
  it('supports additive toggling and actual linked groups', () => {
    expect(selectClip(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(selectClip(['a'], 'a', true)).toEqual([]);
    expect(
      linkedSelection(
        project([
          clip('a', { linkGroupId: 'g' }),
          clip('b', { linkGroupId: 'g' }),
          clip('c'),
        ]),
        ['a'],
        true,
      ),
    ).toEqual(['a', 'b']);
  });
  it('snaps in screen pixels, excludes every moving edge, and resolves ties earlier', () => {
    const p = project([
      clip('a', { start: 4 }),
      clip('b', { start: 10, duration: 1 }),
    ]);
    p.markers = [];
    expect(snapTime(p, 10.08, 100, ['a'], 0).guide).toBe(10);
    expect(snapTime(p, 10.081, 100, ['a'], 0).guide).toBeUndefined();
    expect(snapTime(p, 4, 600, ['a'], 0).guide).toBeUndefined();
    expect(snapTime(p, 10.5, 4, ['a'], 0).guide).toBe(10);
    expect(snapDelta(p, ['a'], 3.01, 100, 0)).toEqual({ delta: 3, guide: 10 });
  });
  it('uses source clock for speed-aware trim and slip bounds', () => {
    const c = clip('a', { speed: 2 });
    const p = project([c]);
    expect(sourceClock(c, 5)).toBe(4);
    const trimmed = applyOps(
      p,
      trimClip(p, 'a', 'in', sourceClock(c, 5), { assets: [source] }),
      1,
    ).clips.a;
    expect(trimmed?.start).toBe(5);
    expect(trimmed?.duration).toBe(2);
    const slipped = applyOps(p, slipClip(p, 'a', 100, [source]), 1).clips.a;
    expect(slipped?.in).toBe(24);
    expect(slipped?.start).toBe(4);
  });
  it('uses one union closure for ripple deletion and supports explicit lift', () => {
    const p = project([
      clip('a', { start: 0, duration: 4 }),
      clip('b', { start: 2, duration: 4 }),
      clip('c', { start: 8 }),
    ]);
    expect(applyOps(p, deleteClips(p, ['a', 'b']), 1).clips.c?.start).toBe(2);
    expect(
      applyOps(p, deleteClips(p, ['a', 'b'], { lift: true }), 1).clips.c?.start,
    ).toBe(8);
  });
  it('ripple trim always starts from baseline and preserves one-frame source limits', () => {
    const p = project([clip(), clip('b', { start: 7 })]);
    const ops = trimClip(p, 'a', 'out', 4, { ripple: true, assets: [source] });
    const result = applyOps(p, ops, 1);
    expect(result.clips.a?.duration).toBe(2);
    expect(result.clips.b?.start).toBe(6);
    expect(
      applyOps(p, trimClip(p, 'a', 'out', 0, { assets: [source] }), 1).clips.a
        ?.duration,
    ).toBeCloseTo(1 / 30);
  });
});

describe('optional actual beat snap candidates', () => {
  const music = () =>
    clip('music', {
      kind: 'audio',
      trackId: 'music-track',
      audioRole: 'music',
      start: 0,
      duration: 20,
      in: 2,
      speed: 2,
    });
  it('uses detected beats in the same 8px pool for trim/time and multi-edge moves', () => {
    const p = project(
      [clip(), music()],
      [track(), track('music-track', 'audio')],
    );
    const beats = [{ clipId: 'music', trackId: 'music-track', time: 9.5 }];
    expect(snapTime(p, 9.57, 100, ['a'], 0, beats)).toEqual({
      time: 9.5,
      guide: 9.5,
    });
    expect(snapTime(p, 9.581, 100, ['a'], 0, beats).guide).toBeUndefined();
    expect(snapDelta(p, ['a'], 2.56, 100, 0, beats)).toEqual({
      delta: 2.5,
      guide: 9.5,
    });
    expect(snapTime(p, 9.57, 100, ['a'], 0).guide).toBeUndefined();
    expect(
      snapTime(p, 9.57, 100, ['a', 'music'], 0, beats).guide,
    ).toBeUndefined();
  });
  it('keeps existing earlier-time tie ordering and does not infer beats from marker labels', () => {
    const p = project([music()], [track('music-track', 'audio')]);
    p.markers = [{ id: 'marker', time: 9, label: 'ordinary marker' }];
    expect(
      snapTime(p, 9.5, 8, [], 0, [
        { clipId: 'music', trackId: 'music-track', time: 10 },
      ]).guide,
    ).toBe(9);
    expect(snapTime(p, 9.5, 8, [], 0).guide).toBe(9);
  });
});

it('retains real trim/speed projection and rejects missing, wrong, nonmusic or hidden identities', () => {
  const music = clip('music', {
    kind: 'audio',
    trackId: 'aud',
    audioRole: 'music',
    start: 3,
    duration: 2,
    in: 4,
    speed: 2,
  });
  const p = project([music], [track('aud', 'audio')]);
  const beats = projectBeats(p, [
    {
      assetId: 'source',
      sourceTimes: [3, 4, 5, 6, 8],
      provenance: 'producer-detected',
    },
  ]);
  expect(validTimelineBeats(p, beats).map((beat) => beat.time)).toEqual([
    3, 3.5, 4,
  ]);
  expect(validTimelineBeats(p, [...beats, ...beats])).toHaveLength(3);
  expect(
    validTimelineBeats(p, [
      { clipId: 'missing', trackId: 'aud', time: 3 },
      { clipId: 'music', trackId: 'wrong', time: 3 },
      { clipId: 'music', trackId: 'aud', time: NaN },
      { clipId: 'music', trackId: 'aud', time: 5 },
    ]),
  ).toEqual([]);
  p.clips.music = { ...music, audioRole: 'voice' };
  expect(validTimelineBeats(p, beats)).toEqual([]);
  p.clips.music = music;
  const row = p.tracks[0];
  if (row) row.hidden = true;
  expect(validTimelineBeats(p, beats)).toEqual([]);
});
