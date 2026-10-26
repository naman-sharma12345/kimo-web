import { test } from '@playwright/test';
import { routes } from './routes';
for (const route of routes) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`screenshots ${route.name} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(route.path);
      await page.locator('[data-ready="true"]').waitFor();
      await page.screenshot({
        path: `docs/screens/phase-${route.phase}-${route.name}-${viewport.width}.png`,
        fullPage: route.name === 'ui',
      });
    });
  }
}
