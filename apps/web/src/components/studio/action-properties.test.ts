import { expect, it } from 'vitest';
import { fixture } from '@/lib/editing/test-fixtures';
import { actionProperties } from './action-properties';
it('reports only actual changed numeric leaves rather than unchanged full-transform fields', () => {
  const p = fixture();
  expect(
    actionProperties(
      p,
      [
        {
          op: 'clip.update',
          id: 'c',
          patch: { transform: { ...p.clips.c.transform, scale: 2 } },
        },
      ],
      'actual-action',
    ),
  ).toEqual([
    {
      clipId: 'c',
      property: 'transform.scale',
      actionId: 'actual-action',
      running: true,
    },
  ]);
});
it('maps typed effect parameter paths to actual inspector property names', () => {
  const p = fixture();
  p.clips.c.effects = [{ id: 'grade', kind: 'grade', params: { exposure: 0 } }];
  expect(
    actionProperties(
      p,
      [
        {
          op: 'effect.set',
          clipId: 'c',
          effect: { id: 'grade', kind: 'grade', params: { exposure: 1 } },
        },
      ],
      'a',
    ),
  ).toEqual([
    {
      clipId: 'c',
      property: 'effects.grade.exposure',
      actionId: 'a',
      running: true,
    },
  ]);
});
it('does not manufacture activity from an identical patch', () => {
  const p = fixture();
  expect(
    actionProperties(
      p,
      [
        {
          op: 'clip.update',
          id: 'c',
          patch: { transform: p.clips.c.transform },
        },
      ],
      'a',
    ),
  ).toEqual([]);
});
