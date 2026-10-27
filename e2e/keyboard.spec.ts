import { expect, test } from '@playwright/test';

test('landing keyboard settings restores focus and preserves prompt', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'describe your video' });
  await editor.fill('synthetic keyboard test');
  const settings = page.getByRole('button', {
    name: 'aspect ratio: auto',
    exact: true,
  });
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeFocused();
  await expect(editor).toHaveValue('synthetic keyboard test');
});
test('gallery dialog traps and restores focus with Escape', async ({
  page,
}) => {
  await page.goto('/dev/ui');
  const trigger = page.getByRole('button', {
    name: 'Open sm dialog',
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(
      await dialog.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
test('studio title commit and shortcuts do not steal text input', async ({
  page,
}) => {
  test.skip(
    process.env.PHASE10_FIXTURE_RUNNER !== '1',
    'Requires separately authorized SSR fixture runner.',
  );
  await page.goto('/studio/studio-default');
  await page.locator('.studio-project-title button').focus();
  await page.keyboard.press('Enter');
  const title = page.getByRole('textbox', {
    name: 'project title',
    exact: true,
  });
  await expect(title).toBeFocused();
  await title.fill('synthetic keyboard title');
  await title.press('b');
  await expect(title).toHaveValue('synthetic keyboard titleb');
  await title.press('Enter');
  await expect(page.locator('.studio-project-title')).toContainText(
    'synthetic keyboard titleb',
  );
});
