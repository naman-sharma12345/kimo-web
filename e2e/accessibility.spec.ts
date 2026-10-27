import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openState, stateCases, viewports } from './state-matrix';

// No rule exclusions: known cream-38 privacy contrast must remain a reported failure.
for (const state of stateCases) {
  for (const viewport of viewports) {
    for (const mode of [
      'default',
      'reduced-motion',
      'high-contrast',
    ] as const) {
      test(`axe ${state.id} ${viewport.width}x${viewport.height} ${mode}`, async ({
        page,
      }, testInfo) => {
        test.skip(
          state.fixture === true && process.env.PHASE10_FIXTURE_RUNNER !== '1',
          'SSR fixture runner unavailable; authored not accepted.',
        );
        await page.setViewportSize(viewport);
        await page.emulateMedia({
          reducedMotion: mode === 'reduced-motion' ? 'reduce' : 'no-preference',
          contrast: mode === 'high-contrast' ? 'more' : 'no-preference',
        });
        await openState(page, state);
        const result = await new AxeBuilder({ page })
          .withTags([
            'wcag2a',
            'wcag2aa',
            'wcag21a',
            'wcag21aa',
            'wcag22aa',
            'best-practice',
          ])
          .analyze();
        await testInfo.attach('axe-result', {
          body: JSON.stringify(result, null, 2),
          contentType: 'application/json',
        });
        expect(result.violations).toEqual([]);
        // Incomplete checks require manual adjudication, not silent green conformance.
        await testInfo.attach('manual-review-required', {
          body: JSON.stringify(result.incomplete, null, 2),
          contentType: 'application/json',
        });
      });
    }
  }
}
