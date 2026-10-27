import { describe, expect, it } from 'vitest';
import * as s from './schema';
import {
  clientFixtures,
  serverFixtures,
  opFixtures,
} from './contract-fixtures';
import {
  clientVariants,
  serverVariants,
  operationVariants,
  restContracts,
  strippedPaths,
} from './contract-manifest';
describe('complete offline discriminant coverage', () => {
  it('covers every schema union without claiming live producer observations', () => {
    for (const [schema, fixtures, manifest, key] of [
      [s.serverEventSchema, serverFixtures, serverVariants, 't'],
      [s.clientEventSchema, clientFixtures, clientVariants, 't'],
      [s.opSchema, opFixtures, operationVariants, 'op'],
    ] as const) {
      expect(Object.keys(fixtures).sort()).toEqual(
        Object.keys(manifest).sort(),
      );
      const variants = schema.options.map((option) => {
        const shape = option.shape;
        return key === 't' && 't' in shape
          ? shape.t.value
          : 'op' in shape
            ? shape.op.value
            : '';
      });
      expect(variants.sort()).toEqual(Object.keys(manifest).sort());
      for (const fixture of Object.values(fixtures))
        expect(schema.safeParse(fixture).success).toBe(true);
    }
  });
  it('inventories JSON, empty and binary REST contracts distinctly', () => {
    expect(restContracts).toHaveLength(14);
    expect(restContracts.find((x) => x.id === 'messages')?.response).toBeNull();
    expect(restContracts.find((x) => x.id === 'frame.head')?.method).toBe(
      'HEAD',
    );
    expect(new Set(restContracts.map((x) => x.id)).size).toBe(
      restContracts.length,
    );
  });
  it('reports stripped structure without leaking unknown names or values', () => {
    const raw = { t: 'hello', version: 0, 'private filename': 'secret' };
    expect(strippedPaths(raw, s.serverEventSchema.parse(raw))).toEqual([
      '$.field[2]',
    ]);
  });
  it('covers all nested lifecycle variants', () => {
    for (const state of ['thinking', 'acting', 'waiting_user', 'idle'])
      expect(
        s.serverEventSchema.safeParse({
          ...serverFixtures['agent.status'],
          state,
        }).success,
      ).toBe(true);
    for (const kind of ['say', 'ask_review', 'ask_choice'])
      expect(
        s.serverEventSchema.safeParse({
          ...serverFixtures['agent.message'],
          kind,
        }).success,
      ).toBe(true);
    for (const step of ['upload', 'probe', 'watch', 'plan', 'ready'])
      expect(
        s.serverEventSchema.safeParse({
          ...serverFixtures['warmup.step'],
          step,
        }).success,
      ).toBe(true);
    expect(
      s.clientEventSchema.parse({
        ...clientFixtures.interrupt,
        clientMessageId: 'm',
      }),
    ).toHaveProperty('clientMessageId');
  });
});

describe('REST response fixtures and lifecycle variants', () => {
  it('parses every JSON response contract without inventing optional facts', async () => {
    const { project, asset } = await import('./contract-fixtures');
    const fixtures = {
      uploads: {
        uploads: [
          { assetId: 'a', putUrl: 'https://storage.test/signed', headers: {} },
        ],
      },
      'upload.complete': { ok: true },
      'sessions.create': {
        sessionId: 's',
        wsUrl: 'wss://ws.test/live/s?token=fixture',
      },
      'sessions.read': { status: 'editing', assets: [asset], project },
      ops: { version: 1 },
      approve: { renderId: 'r' },
      'renders.read': {
        status: 'queued',
        progress: 0,
        frame: 0,
        totalFrames: 240,
        etaSec: 0,
      },
      cancel: { status: 'cancelled', sessionId: 's' },
      reopen: { status: 'editing' },
      'videos.read': {
        url: '/fixture.mp4',
        posterUrl: '/poster.jpg',
        durationSec: 8,
        width: 1920,
        height: 1080,
        sizeBytes: 1,
        title: 'fixture',
      },
    };
    for (const contract of restContracts) {
      if (!contract.response) continue;
      expect(contract.id in fixtures).toBe(true);
      const raw: unknown = Reflect.get(fixtures, contract.id);
      expect(contract.response.safeParse(raw).success).toBe(true);
    }
    for (const status of s.sessionSnapshotSchema.shape.status.options)
      expect(
        s.sessionSnapshotSchema.safeParse({
          ...fixtures['sessions.read'],
          status,
        }).success,
      ).toBe(true);
    for (const status of s.renderSchema.shape.status.options)
      expect(
        s.renderSchema.safeParse({ ...fixtures['renders.read'], status })
          .success,
      ).toBe(true);
  });
});
