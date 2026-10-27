import { expect, test } from '@playwright/test';
import { openState, stateCases, viewports } from './state-matrix';

// CSS reflow proxy ONLY, not native browser zoom or a WCAG 1.4.4 acceptance claim.
for (const state of stateCases.filter((item) => !item.force)) {
  for (const viewport of viewports) {
    test(`200 percent reflow proxy ${state.id} ${viewport.width}`, async ({
      page,
    }) => {
      test.skip(
        state.fixture === true && process.env.PHASE10_FIXTURE_RUNNER !== '1',
        'Requires SSR fixture runner.',
      );
      await page.setViewportSize({
        width: Math.floor(viewport.width / 2),
        height: Math.floor(viewport.height / 2),
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openState(page, state);
      await expect(page).toHaveScreenshot(
        `${state.id}-${viewport.width}-200-percent-reflow-proxy.png`,
        { fullPage: true },
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  }
}
