import { expect, test } from '@playwright/test';

// AUTHORED NOT RUN. Fixture states do not establish production recovery semantics.
test.describe('read-only SSR fixture failure boundaries', () => {
  test.beforeEach(() => {
    test.skip(
      process.env.PHASE10_FIXTURE_RUNNER !== '1',
      'Authorized SSR fixture service required.',
    );
  });
  test('render failure offers reviewed retry, never another approval automatically', async ({
    page,
  }) => {
    const approvals: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/approve'))
        approvals.push(request.url());
    });
    await page.goto('/render/render-failed');
    await expect(
      page.getByRole('heading', { name: 'the render hit a problem' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'try again', exact: true }),
    ).toBeEnabled();
    expect(approvals).toEqual([]);
  });
  test('expired video is distinct from unavailable service', async ({
    page,
  }) => {
    await page.goto('/v/video-expired');
    await expect(
      page.getByRole('heading', { name: 'this link has expired' }),
    ).toBeVisible();
    await page.goto('/v/video-unavailable');
    await expect(
      page.getByRole('heading', { name: 'unable to load this link' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'try again', exact: true }),
    ).toBeVisible();
  });
  test('expired download and unverified ownership do not offer enabled actions', async ({
    page,
  }) => {
    await page.goto('/v/video-expired-download');
    await expect(
      page.getByRole('button', { name: 'download mp4', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'edit again', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText('the download link has expired.', { exact: false }),
    ).toBeVisible();
  });
  test('socket closure never authorizes claiming saved queue durability', async ({
    page,
  }) => {
    await page.goto('/studio/studio-offline');
    await expect(page.getByTestId('studio-shell')).toBeVisible();
    // A static drop fixture checks only a connection signal. No edit is sent.
    await expect(
      page
        .getByText(/reconnecting|disconnected|not connected|offline|connecting/)
        .first(),
    ).toBeVisible();
  });
});

test('anonymous second-video limit requires agreed backend contract', () => {
  test.fixme(
    true,
    'BLOCKED: producer quota policy/error and backend Google auth not agreed. No fabricated 429 or local counter.',
  );
});
test('mid-edit drop and durable ordered recovery require integrated IDB handoff', () => {
  test.fixme(
    true,
    'BLOCKED: separate durability/recovery owner active; static disconnect fixture is not queued-edit/reload acceptance.',
  );
});
test('upload presign failure is explicit and preserves user prompt', async ({
  page,
}) => {
  await page.route('**/v1/uploads', (r) =>
    r.fulfill({ status: 503, body: 'synthetic upload unavailable' }),
  );
  await page.goto('/');
  const prompt = page.getByRole('textbox', { name: 'describe your video' });
  await prompt.fill('preserve synthetic upload prompt');
  const response = page.waitForResponse('**/v1/uploads');
  await page
    .locator('input[type=file]')
    .setInputFiles('apps/web/public/grain.png');
  expect((await response).status()).toBe(503);
  await expect(prompt).toHaveValue('preserve synthetic upload prompt');
  await expect(
    page.getByRole('button', { name: 'remove grain.png', exact: true }),
  ).toBeEnabled();
  // This requirement may expose a missing app error surface; never weaken to response-only success.
  await expect(page.getByRole('alert').last()).toBeVisible();
});
