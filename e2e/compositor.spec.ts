import { expect, test } from '@playwright/test';
import { goldenCases } from '../apps/web/src/app/dev/compositor/fixture';
// AUTHORED ONLY. Do not execute locally. Parent owns managed-browser acceptance.
// Baselines require the same browser/backend/fonts/source fixtures. These are not server-reference frames.
for (const fixture of goldenCases)
  test(`compositor fixed golden ${fixture.id}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(
      `/dev/compositor?case=${fixture.id}&frame=${fixture.frame}&debug=0`,
    );
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByTestId('compositor')).toHaveAttribute(
      'data-rendered-frame',
      String(fixture.frame),
    );
    await expect(page.getByTestId('compositor')).toHaveAttribute(
      'data-preparing',
      'false',
    );
    await expect(page.getByLabel('preview overlays')).toHaveAttribute(
      'data-text-bounds-ready',
      'true',
    );
    await expect(page.getByTestId('compositor')).toHaveScreenshot(
      `phase-06-${fixture.id}.png`,
      { maxDiffPixelRatio: 0.01, animations: 'disabled' },
    );
  });
test('fullscreen keeps canvas and applies edits without remount', async ({
  page,
}) => {
  await page.goto('/dev/compositor?case=caption-words&frame=45');
  const canvas = page.getByTestId('compositor-canvas');
  await expect(canvas).toBeVisible();
  await canvas.evaluate((node) =>
    node.setAttribute('data-identity', 'same-context'),
  );
  await page.keyboard.press('f');
  await expect(page.getByTestId('compositor')).toHaveAttribute(
    'data-fullscreen',
    'true',
  );
  await expect(canvas).toHaveAttribute('data-identity', 'same-context');
  await page
    .getByRole('button', { name: 'fixture edit', exact: true })
    .evaluate((node: HTMLButtonElement) => node.click());
  await expect(canvas).toHaveAttribute('data-identity', 'same-context');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('compositor')).not.toHaveAttribute(
    'data-fullscreen',
    'true',
  );
});
test('overload is explicit rather than claiming seven exact decoders', async ({
  page,
}) => {
  await page.goto('/dev/compositor?overload=1&frame=45&debug=1');
  await expect(page.getByTestId('compositor-fixture')).toHaveAttribute(
    'data-max-videos',
    '7',
  );
  await expect(
    page.getByText('preview approx.', { exact: true }),
  ).toBeVisible();
});
