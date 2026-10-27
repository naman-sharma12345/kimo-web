import { expect, test } from '@playwright/test';
import { openState, stateCases, viewports } from './state-matrix';

// AUTHORED NOT RUN. No baselines captured. Explicit runner authorization is separate.
// Missing images FAIL rather than silently becoming accepted baselines.
for (const state of stateCases) {
  for (const viewport of viewports) {
    for (const mode of [
      'default',
      'reduced-motion',
      'high-contrast',
    ] as const) {
      test(`screenshots ${state.id} ${viewport.width}x${viewport.height} ${mode}`, async ({
        page,
      }) => {
        test.skip(
          state.fixture === true && process.env.PHASE10_FIXTURE_RUNNER !== '1',
          'Requires authorized SSR fixture service; see e2e/README.md. Not accepted coverage.',
        );
        await page.setViewportSize(viewport);
        await page.emulateMedia({
          reducedMotion: mode === 'reduced-motion' ? 'reduce' : 'no-preference',
          contrast: mode === 'high-contrast' ? 'more' : 'no-preference',
        });
        await openState(page, state);
        await expect(page).toHaveScreenshot(
          `${state.id}-${viewport.width}x${viewport.height}-${mode}.png`,
          { fullPage: state.path === '/dev/ui' },
        );
      });
    }
  }
}
