import { expect, it } from 'vitest';
import { transitionChips } from './transitions';
import { clip } from './test-fixtures';
it('uses real incoming transition metadata before outgoing declaration at one cut', () => {
  expect(
    transitionChips(
      [
        clip('a', {
          start: 0,
          duration: 4,
          transitionOut: { kind: 'dip', duration: 0.5 },
        }),
        clip('b', {
          start: 4,
          transitionIn: { kind: 'crossfade', durationFrames: 12 },
        }),
      ],
      30,
    ),
  ).toEqual([{ clipId: 'b', at: 4, label: 'cross dissolve · 12f' }]);
});
