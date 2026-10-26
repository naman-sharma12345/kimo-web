import { test } from '@playwright/test';
import { routes } from './routes';
import { installWarmupPreview } from './preview-fixture';
for (const route of routes) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`screenshots ${route.name} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      if (route.name === 'warmup') await installWarmupPreview(page);
      await page.goto(route.path);
      await page.locator('[data-ready="true"]').waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.screenshot({
        path: `docs/screens/phase-${route.phase}-${route.name}-${viewport.width}.png`,
        fullPage: route.name === 'ui',
      });
    });
  }
}

for (const route of routes) {
  test(`screenshots ${route.name} reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (route.name === 'warmup') await installWarmupPreview(page);
    await page.goto(route.path);
    await page.locator('[data-ready="true"]').waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.screenshot({
      path: `docs/screens/phase-${route.phase}-${route.name}-reduced.png`,
      fullPage: route.name === 'ui',
    });
  });
}
