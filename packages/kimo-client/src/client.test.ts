import { describe, it, expect, vi } from 'vitest';
import { KimoClient, ApiError } from './client';
import { applyOps } from './ops';
import type { KimoProject, Clip } from './schema';
const sampleProject: KimoProject = {
  id: 'p',
  version: 0,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 0,
  tracks: [],
  clips: {},
  markers: [],
};
const sampleClip: Clip = {
  id: 'c',
  trackId: 'v1',
  kind: 'video',
  start: 0,
  duration: 8,
  in: 0,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  effects: [],
  keyframes: [],
  speed: 1,
};
import type { Op } from './schema';
const snapshot = (version: number) => ({
  status: 'editing',
  assets: [],
  project: { ...sampleProject, version },
});
describe('client recovery', () => {
  it('encodes session IDs and validates requests before sending', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(snapshot(0))));
    const client = new KimoClient('http://mock', request);
    await client.session('a/b');
    expect(request.mock.calls[0]?.[0]).toBe('http://mock/v1/sessions/a%2Fb');
    expect(() => client.ops('a', [], -1)).toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('applies consecutive batches, ignores duplicates and refetches gaps', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(snapshot(4))));
    const client = new KimoClient('http://mock', request);
    const next = await client.reconcile('s', sampleProject, {
      t: 'project.ops',
      version: 1,
      ops: [{ op: 'clip.add', clip: sampleClip }],
    });
    expect(next.clips.c).toEqual(sampleClip);
    expect(
      await client.reconcile('s', next, {
        t: 'project.ops',
        version: 1,
        ops: [],
      }),
    ).toBe(next);
    expect(
      (
        await client.reconcile('s', next, {
          t: 'project.ops',
          version: 4,
          ops: [],
        })
      ).version,
    ).toBe(4);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('refetches and reapplies edits after 409 only once', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('conflict', { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot(5))))
      .mockResolvedValueOnce(new Response('{"version":6}'));
    const result = await new KimoClient('http://mock', request).edit(
      's',
      sampleProject,
      [{ op: 'clip.add', clip: sampleClip }],
    );
    expect(result.version).toBe(6);
    expect(result.clips.c).toEqual(sampleClip);
    expect(JSON.parse(String(request.mock.calls[2]?.[1]?.body))).toMatchObject({
      baseVersion: 5,
    });
  });
  it('does not retry other errors', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('failure', { status: 503 }));
    await expect(
      new KimoClient('http://mock', request).edit('s', sampleProject, []),
    ).rejects.toBeInstanceOf(ApiError);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('scales source offsets when splitting and trimming accelerated clips', () => {
    const project = applyOps(sampleProject, [
      { op: 'clip.add', clip: { ...sampleClip, speed: 2 } },
    ]);
    expect(
      applyOps(project, [{ op: 'clip.split', id: 'c', at: 3, newId: 'right' }])
        .clips.right?.in,
    ).toBe(6);
    expect(
      applyOps(project, [{ op: 'clip.trim', id: 'c', edge: 'in', value: 2 }])
        .clips.c,
    ).toMatchObject({ in: 2, start: 1, duration: 7 });
  });
  it('does not retain mutable operation references', () => {
    const ops: Op[] = [
      { op: 'clip.add', clip: sampleClip },
      {
        op: 'effect.set',
        clipId: 'c',
        effect: { id: 'e', kind: 'grade', params: { gain: 1 } },
      },
    ];
    const result = applyOps(sampleProject, ops);
    if (ops[1]?.op === 'effect.set') ops[1].effect.params.gain = 2;
    expect(result.clips.c?.effects[0]?.params.gain).toBe(1);
  });
});
