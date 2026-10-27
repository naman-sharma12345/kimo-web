import { expect, test } from '@playwright/test';

// Disjoint from read-only fixture service. One disposable MOCK session, mutations explicitly gated.
// AUTHORED NOT RUN; requires GPU runner and real synthetic mock service, never production.
test('prompt to warmup to edit interrupt title review render download', async ({
  page,
}) => {
  test.setTimeout(240000);
  test.skip(
    process.env.PHASE10_DISPOSABLE_MOCK_RUNNER !== '1',
    'Disposable mock mutation + GPU runner authority required.',
  );
  await page.goto('/');
  const prompt = page.getByRole('textbox', { name: 'describe your video' });
  await prompt.fill('synthetic test: an eight second title card');
  await prompt.press('Enter');
  await expect(page).toHaveURL(/\/warmup\//);
  await expect(page).toHaveURL(/\/studio\//, { timeout: 90000 });
  // Renderer failure is a real blocker, not a skipped pixel/fidelity pass.
  await expect(
    page.getByRole('button', { name: 'play preview', exact: true }),
  ).toBeEnabled();
  const message = page.getByRole('textbox', { name: 'message kimo' });
  await message.fill('make it slower and add a calm track');
  await message.press('Enter');
  await expect(message).toBeEmpty();
  await page.locator('.studio-project-title button').click();
  const title = page.getByRole('textbox', {
    name: 'project title',
    exact: true,
  });
  await title.fill('synthetic authored workflow');
  await title.press('Enter');
  await page.getByRole('button', { name: 'finish', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('ready to render?');
  await page.getByRole('button', { name: 'render 1080p', exact: true }).click();
  await expect(page).toHaveURL(/\/render\//);
  await expect(page).toHaveURL(/\/v\//, { timeout: 90000 });
  const download = page.getByRole('link', {
    name: 'download mp4',
    exact: true,
  });
  await expect(download).toBeVisible();
  const [receipt] = await Promise.all([
    page.waitForEvent('download'),
    download.click(),
  ]);
  expect(receipt.suggestedFilename()).toMatch(/\.mp4$/);
  expect(await receipt.failure()).toBeNull();
});
