import { expect, test } from '@playwright/test';

// Prepared for the parent-owned managed-browser gate. Do not launch a local browser.
// Supply an existing authoritative editing session; this suite never creates/approves edits.
const sessionPath = process.env.STUDIO_TEST_PATH;
test.describe('Phase 5 studio shell geometry', () => {
  test.skip(
    !sessionPath,
    'STUDIO_TEST_PATH must name a restored editing session',
  );
  for (const size of [
    { width: 1920, height: 1080, agent: 360, inspector: 320, timeline: 320 },
    { width: 1440, height: 900, agent: 320, inspector: 280, timeline: 280 },
    { width: 1280, height: 800, agent: 320, inspector: 280, timeline: 280 },
  ]) {
    test(`${size.width} × ${size.height} panel boxes`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.addInitScript(() => {
        localStorage.removeItem('kimo-studio:v1:browser-profile');
      });
      await page.goto(sessionPath ?? '/');
      await expect(page.getByTestId('studio-shell')).toBeVisible();
      const upperHeight = size.height - 48 - 28 - 24 - size.timeline;
      const viewerWidth = size.width - 32 - size.agent - size.inspector;
      const expected = {
        'studio-topbar': { x: 0, y: 0, width: size.width, height: 48 },
        'studio-agent': { x: 8, y: 56, width: size.agent, height: upperHeight },
        'studio-viewer': {
          x: 16 + size.agent,
          y: 56,
          width: viewerWidth,
          height: upperHeight,
        },
        'studio-inspector': {
          x: size.width - 8 - size.inspector,
          y: 56,
          width: size.inspector,
          height: upperHeight,
        },
        'studio-timeline': {
          x: 8,
          y: size.height - 36 - size.timeline,
          width: size.width - 16,
          height: size.timeline,
        },
        'studio-statusbar': {
          x: 0,
          y: size.height - 28,
          width: size.width,
          height: 28,
        },
      };
      for (const [id, target] of Object.entries(expected)) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box, id).not.toBeNull();
        if (!box) throw new Error(`missing ${id}`);
        for (const key of ['x', 'y', 'width', 'height'] as const)
          expect(
            Math.abs(box[key] - target[key]),
            `${id}.${key}`,
          ).toBeLessThanOrEqual(1);
      }
    });
  }
  test('390 × 844 watch mode uses one lower pane without page overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(sessionPath ?? '/');
    await expect(
      page.getByText('for full editing, open kimo on a bigger screen'),
    ).toBeVisible();
    await expect(page.getByTestId('studio-viewer')).toBeVisible();
    await page.getByRole('tab', { name: 'timeline', exact: true }).click();
    await expect(page.getByTestId('studio-timeline')).toBeVisible();
    await expect(page.getByTestId('studio-agent')).toBeHidden();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
