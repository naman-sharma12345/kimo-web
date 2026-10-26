import { expect, test } from '@playwright/test';
test.describe('phase 2 landing', () => {
  test('760px composer, exact copy and prompt chips', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(
      page.getByRole('heading', {
        name: 'tell it the video. watch it get made.',
      }),
    ).toBeVisible();
    const composer = page.locator('.landing-composer');
    await expect(composer).toBeVisible();
    const box = await composer.boundingBox();
    expect(box?.width).toBe(760);
    await page
      .getByRole('button', { name: 'trip montage', exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: 'describe your video' }),
    ).toHaveValue(
      'a 30 second reel of my trip to manali, upbeat, with captions',
    );
  });
  test('keyboard newline, escape, aspect and length menu', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByRole('textbox', { name: 'describe your video' });
    await editor.fill('first');
    await editor.press('Shift+Enter');
    await editor.press('End');
    await editor.press('Escape');
    await expect(editor).not.toBeFocused();
    await page
      .getByRole('button', { name: 'aspect ratio: auto', exact: true })
      .click();
    await page.getByRole('menuitem', { name: '9:16', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'aspect ratio: 9:16' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'any length', exact: true }).click();
    await page.getByRole('menuitem', { name: '30s', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '30s', exact: true }),
    ).toBeVisible();
  });
  test('rejects unsupported files and preserves prompt on failed session creation', async ({
    page,
  }) => {
    await page.route('**/v1/sessions', (route) =>
      route.fulfill({ status: 503, body: 'unavailable' }),
    );
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({
      name: 'bad.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('no'),
    });
    await expect(page.getByRole('alert')).toContainText(
      'bad.exe can’t be used: that file type isn’t supported yet',
    );
    const editor = page.getByRole('textbox', { name: 'describe your video' });
    await editor.fill('keep this prompt');
    await editor.press('Enter');
    await expect(page.getByRole('alert').last()).toContainText(
      'couldn’t start a session. your files are still here, try again.',
    );
    await expect(editor).toHaveValue('keep this prompt');
  });
  test('mobile settings sheet and sign-in placeholder are accessible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page
      .getByRole('button', { name: 'video settings', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'sign in', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(
      'accounts are coming soon.',
    );
    await page.getByRole('button', { name: 'ok', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
