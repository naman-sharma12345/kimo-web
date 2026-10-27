import { expect, it } from 'vitest';
import { hoverTint } from './color';
it('adds four HSL lightness percentage points rather than an inaccurate alpha wash', () => {
  expect(hoverTint('rgb(51 51 51)')).toBe('hsl(0 0% 24%)');
  expect(hoverTint('rgb(255 255 255)')).toBe('hsl(0 0% 100%)');
  expect(hoverTint('var(--unresolved)')).toBe('var(--unresolved)');
});
