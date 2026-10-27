import { describe, expect, it, vi } from 'vitest';
import { KimoClient } from './client';
import { applyOps } from './ops';
import {
  clipSchema,
  effectSchema,
  opSchema,
  projectSchema,
  serverEventSchema,
  type Clip,
  type KimoProject,
} from './schema';
const clip: Clip = {
  id: 'text',
  trackId: 'txt',
  kind: 'text',
  start: 0,
  in: 0,
  duration: 3,
  speed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  effects: [],
  keyframes: [],
  text: { content: 'hello', style: 'caption-clean' },
};
const project: KimoProject = {
  id: 'p',
  version: 4,
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 3,
  tracks: [
    {
      id: 'txt',
      kind: 'text',
      name: 'text',
      muted: false,
      locked: false,
      hidden: false,
      height: 48,
    },
  ],
  clips: { text: clip },
  markers: [],
};
describe('Phase 7 proposed wire contract', () => {
  it('preserves legacy text and adds validated optional inspector fields without defaults', () => {
    expect(clipSchema.parse(clip)).toEqual(clip);
    const styled = {
      ...clip,
      text: {
        ...clip.text,
        fontSize: 56,
        alignment: 'right',
        color: [1, 0.5, 0, 1],
        animation: 'pop words',
        position: 'bottom',
        secondaryContent: 'secondary',
      },
    };
    expect(clipSchema.parse(styled)).toEqual(styled);
    for (const animation of ['none', 'fade', 'rise', 'type on', 'pop words'])
      expect(
        opSchema.safeParse({
          op: 'clip.update',
          id: 'text',
          patch: { text: { content: 'test', style: 'title-bold', animation } },
        }).success,
      ).toBe(true);
  });
  it.each([
    { fontSize: 0 },
    { fontSize: Infinity },
    { color: [1, 0, 0, 2] },
    { alignment: 'middle' },
    { animation: 'type_on' },
    { position: 'center' },
  ])(
    'rejects invalid text field %j at snapshots and request patches',
    (fields) => {
      const text = { content: 'a', style: 'caption-clean', ...fields };
      expect(clipSchema.safeParse({ ...clip, text }).success).toBe(false);
      expect(
        opSchema.safeParse({ op: 'clip.update', id: clip.id, patch: { text } })
          .success,
      ).toBe(false);
    },
  );
  it('retains typed audio fields/effect visibility in snapshots and patches, and rejects nonfinite/negative fades', () => {
    const audio = {
      ...clip,
      kind: 'audio',
      text: undefined,
      fadeInSec: 0.2,
      fadeOutSec: 0.4,
      keepPitch: true,
      duckUnderVoice: false,
      linkGroupId: 'link',
    };
    expect(clipSchema.parse(audio)).toMatchObject(audio);
    expect(
      opSchema.parse({
        op: 'clip.update',
        id: 'audio',
        patch: { fadeInSec: 0.2, fadeOutSec: 0.4, keepPitch: true },
      }),
    ).toMatchObject({
      patch: { fadeInSec: 0.2, fadeOutSec: 0.4, keepPitch: true },
    });
    expect(
      effectSchema.parse({
        id: 'fx',
        kind: 'blur',
        params: { radius: 2 },
        enabled: false,
      }).enabled,
    ).toBe(false);
    for (const fadeInSec of [-1, Infinity, NaN])
      expect(clipSchema.safeParse({ ...audio, fadeInSec }).success).toBe(false);
    expect(
      clipSchema.safeParse({
        ...clip,
        transform: { ...clip.transform, x: Infinity },
      }).success,
    ).toBe(false);
  });
  it('allows only supported dimension pairs together and validates finite normalized background', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
    ])
      expect(
        opSchema.safeParse({
          op: 'project.update',
          patch: {
            width,
            height,
            background: [0, 0, 0, 1],
            notes: 'notes for kimo',
          },
        }).success,
      ).toBe(true);
    for (const patch of [
      { width: 1080 },
      { height: 1080 },
      { width: 1920, height: 1920 },
      { fps: 60 },
      { background: [0, 0, 2, 1] },
    ])
      expect(opSchema.safeParse({ op: 'project.update', patch }).success).toBe(
        false,
      );
    expect(
      projectSchema.safeParse({ ...project, width: 1920, height: 1920 })
        .success,
    ).toBe(false);
  });
  it('updates text words and secondary text in one compatible op, preserving existing properties', () => {
    const next = applyOps(
      project,
      [
        opSchema.parse({
          op: 'text.update',
          clipId: 'text',
          content: 'new words',
          secondaryContent: 'other',
          words: [
            { w: 'new', t: 0, d: 1.5 },
            { w: 'words', t: 1.5, d: 1.5 },
          ],
        }),
      ],
      project.version,
    );
    expect(next.clips.text?.text).toMatchObject({
      content: 'new words',
      secondaryContent: 'other',
      style: 'caption-clean',
      words: [
        { w: 'new', t: 0, d: 1.5 },
        { w: 'words', t: 1.5, d: 1.5 },
      ],
    });
    expect(next.version).toBe(4);
    expect(project.clips.text?.text?.content).toBe('hello');
    expect(
      applyOps(project, [
        { op: 'text.update', clipId: 'text', content: 'old producer' },
      ]).clips.text?.text,
    ).toEqual({ style: 'caption-clean', content: 'old producer' });
  });
  it('applies project update without erasing transitions or altering action IDs', () => {
    const next = applyOps(project, [
      {
        op: 'project.update',
        patch: {
          width: 1080,
          height: 1920,
          background: [1, 1, 1, 1],
          notes: 'portrait',
        },
      },
    ]);
    expect(next).toMatchObject({
      width: 1080,
      height: 1920,
      notes: 'portrait',
      version: 5,
    });
    expect(next.clips.text).toEqual(clip);
    expect(
      serverEventSchema.parse({
        t: 'project.ops',
        version: 6,
        ops: [],
        actionId: 'actual-action',
        author: 'agent',
        clientMutationId: 'optional',
      }),
    ).toMatchObject({
      actionId: 'actual-action',
      author: 'agent',
      clientMutationId: 'optional',
    });
    expect(
      serverEventSchema.parse({ t: 'project.ops', version: 6, ops: [] }),
    ).toEqual({ t: 'project.ops', version: 6, ops: [] });
  });
  it('permits track.remove only for empty tracks in the reducer', () => {
    expect(() =>
      applyOps(project, [{ op: 'track.remove', id: 'txt' }]),
    ).toThrow('empty');
    const next = applyOps(project, [
      { op: 'clip.remove', id: 'text' },
      { op: 'track.remove', id: 'txt' },
    ]);
    expect(next.tracks).toEqual([]);
    expect(next.clips).toEqual({});
  });
  it.each([
    ['grade', 'exposure', 17],
    ['grade', 'gammaR', 0],
    ['blur', 'radius', 257],
    ['grain', 'amount', 1.1],
    ['sharpen', 'amount', -1],
    ['vignette', 'strength', 2],
  ])(
    'rejects out-of-range %s.%s=%s in actual effect schemas',
    (kind, key, value) => {
      expect(
        effectSchema.safeParse({ id: 'fx', kind, params: { [key]: value } })
          .success,
      ).toBe(false);
    },
  );
  it('validates before HTTP and sends request identity only when explicitly supplied', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(JSON.stringify({ version: 5 })),
      );
    const client = new KimoClient('http://test', fetcher);
    await client.ops(
      's',
      [{ op: 'project.update', patch: { notes: 'notes' } }],
      4,
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      ops: [{ op: 'project.update', patch: { notes: 'notes' } }],
      baseVersion: 4,
    });
    const abort = new AbortController();
    await client.ops('s', [], 4, {
      signal: abort.signal,
      clientMutationId: 'proposed-id',
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      clientMutationId: 'proposed-id',
    });
    expect(fetcher.mock.calls[1]?.[1]?.signal).toBe(abort.signal);
    expect(() =>
      client.ops(
        's',
        [opSchema.parse({ op: 'project.update', patch: { width: 1080 } })],
        4,
      ),
    ).toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
