import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for (const route of ['/dev/ui', '/']) {
  test(`axe audit ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.locator('[data-ready="true"]').waitFor();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
