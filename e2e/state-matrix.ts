import { expect, type Locator, type Page } from '@playwright/test';

export const viewports = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 390, height: 844 },
] as const;
export type StateCase = {
  id: string;
  path: string;
  fixture?: boolean;
  ready: string;
  force?: (page: Page) => Promise<void>;
};
const button = (page: Page) =>
  page.getByRole('button', { name: 'trip montage', exact: true });
export const stateCases: readonly StateCase[] = [
  { id: 'tokens', path: '/dev/tokens', ready: '[data-ready=true]' },
  { id: 'ui-all-forced-states', path: '/dev/ui', ready: '[data-ready=true]' },
  {
    id: 'ui-menu',
    path: '/dev/ui',
    ready: '[data-ready=true]',
    force: async (p) => {
      await p
        .getByRole('button', { name: 'Project actions', exact: true })
        .click();
      await expect(p.getByRole('menu').first()).toBeVisible();
    },
  },
  {
    id: 'ui-dialog',
    path: '/dev/ui',
    ready: '[data-ready=true]',
    force: async (p) => {
      await p
        .getByRole('button', { name: 'Open sm dialog', exact: true })
        .click();
      await expect(p.getByRole('dialog')).toBeVisible();
    },
  },
  { id: 'landing-empty-disabled', path: '/', ready: '[data-ready=true]' },
  {
    id: 'landing-hover',
    path: '/',
    ready: '[data-ready=true]',
    force: async (p) => {
      await button(p).hover();
    },
  },
  {
    id: 'landing-keyboard-focus',
    path: '/',
    ready: '[data-ready=true]',
    force: async (p) => {
      await p.keyboard.press('Tab');
      await button(p).focus();
      await expect(button(p)).toBeFocused();
    },
  },
  {
    id: 'landing-pressed',
    path: '/',
    ready: '[data-ready=true]',
    force: async (p) => {
      await button(p).hover();
      await p.mouse.down();
    },
  },
  {
    id: 'landing-long-text',
    path: '/',
    ready: '[data-ready=true]',
    force: async (p) => {
      await p
        .getByRole('textbox', { name: 'describe your video' })
        .fill('synthetic long prompt with unbrokenfilename'.repeat(30));
    },
  },
  {
    id: 'landing-upload-error',
    path: '/',
    ready: '[data-ready=true]',
    force: async (p) => {
      await p.locator('input[type=file]').setInputFiles({
        name: 'synthetic.exe',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('rejected fixture'),
      });
      await expect(p.getByRole('alert').last()).toBeVisible();
    },
  },
  {
    id: 'landing-session-error',
    path: '/',
    ready: '[data-ready=true]',
    force: async (p) => {
      await p.route('**/v1/sessions', (r) =>
        r.fulfill({ status: 503, body: 'synthetic unavailable' }),
      );
      const input = p.getByRole('textbox', { name: 'describe your video' });
      await input.fill('synthetic failure');
      await input.press('Enter');
      await expect(p.getByRole('alert').last()).toBeVisible();
      await expect(input).toHaveValue('synthetic failure');
    },
  },
  {
    id: 'landing-loading',
    path: '/',
    ready: '[data-ready=true]',
    force: async (p) => {
      await p.route('**/v1/sessions', () => undefined);
      const input = p.getByRole('textbox', { name: 'describe your video' });
      await input.fill('synthetic loading');
      await input.press('Enter');
      await expect(p.locator('[data-sending=true]').first()).toBeVisible();
    },
  },
  {
    id: 'landing-upload-network-error',
    path: '/',
    ready: '[data-ready=true]',
    force: async (p) => {
      await p.route('**/v1/uploads', (r) =>
        r.fulfill({ status: 503, body: 'synthetic upload unavailable' }),
      );
      const input = p.getByRole('textbox', { name: 'describe your video' });
      await input.fill('preserve synthetic upload prompt');
      const response = p.waitForResponse('**/v1/uploads');
      await p
        .locator('input[type=file]')
        .setInputFiles('apps/web/public/grain.png');
      expect((await response).status()).toBe(503);
      await expect(input).toHaveValue('preserve synthetic upload prompt');
      // Required user-visible failure; if absent this test exposes the gap, not a green upload pass.
      await expect(p.getByRole('alert').last()).toBeVisible();
    },
  },
  { id: 'privacy', path: '/privacy', ready: 'main h1' },
  { id: 'not-found', path: '/phase10-missing-route', ready: 'main' },
  ...[
    ['warmup-loading', '/warmup/warmup-watch', '[data-ready=true]'],
    ['warmup-error', '/warmup/warmup-error', '.session-error-screen'],
    ['warmup-offline', '/warmup/warmup-offline', '[data-ready=true]'],
    ['studio-empty', '/studio/studio-empty', '[data-testid=studio-shell]'],
    ['studio-default', '/studio/studio-default', '[data-testid=studio-shell]'],
    ['studio-long', '/studio/studio-long', '[data-testid=studio-shell]'],
    ['studio-offline', '/studio/studio-offline', '[data-testid=studio-shell]'],
    ['studio-restore-error', '/studio/studio-unavailable', 'main'],
    ['render-running', '/render/render-running', '[data-render-ready]'],
    ['render-queued', '/render/render-queued', '[data-render-ready]'],
    ['render-failed', '/render/render-failed', '[data-state=failed]'],
    ['render-expired', '/render/render-expired', 'main h1'],
    ['render-unavailable', '/render/render-unavailable', 'main h1'],
    ['delivery-default', '/v/video-default', '[data-delivery-ready]'],
    ['delivery-long', '/v/video-long', '[data-delivery-ready]'],
    [
      'delivery-expired-download',
      '/v/video-expired-download',
      '[data-delivery-ready]',
    ],
    ['delivery-expired', '/v/video-expired', 'main h1'],
    ['delivery-missing', '/v/video-missing', 'main'],
  ].map(([id = '', path = '', ready = '']) => ({
    id,
    path,
    ready,
    fixture: true,
  })),
  {
    id: 'warmup-cancel-dialog',
    path: '/warmup/warmup-watch',
    ready: '[data-ready=true]',
    fixture: true,
    force: async (p) => {
      await p.getByRole('button', { name: 'cancel', exact: true }).click();
      await expect(p.getByRole('dialog')).toBeVisible();
    },
  },
  {
    id: 'studio-review-poster-unavailable',
    path: '/studio/studio-default',
    ready: '[data-testid=studio-shell]',
    fixture: true,
    force: async (p) => {
      await p.getByRole('button', { name: 'finish', exact: true }).click();
      await expect(
        p.getByRole('dialog').filter({ hasText: 'ready to render?' }),
      ).toBeVisible();
    },
  },
  {
    id: 'render-cancel-unknown',
    path: '/render/render-running',
    ready: '[data-render-ready]',
    fixture: true,
    force: async (p) => {
      await p.route('**/v1/renders/*/cancel', (r) => r.abort('failed'));
      const back = p.getByRole('button', {
        name: 'back to editing',
        exact: true,
      });
      await expect(back).toBeEnabled();
      await back.click();
      await p
        .getByRole('button', { name: 'cancel render', exact: true })
        .click();
      await expect(
        p.getByRole('button', { name: 'check status', exact: true }),
      ).toBeVisible();
    },
  },
  {
    id: 'render-cancel-dialog',
    path: '/render/render-running',
    ready: '[data-render-ready]',
    fixture: true,
    force: async (p) => {
      const back = p.getByRole('button', {
        name: 'back to editing',
        exact: true,
      });
      await expect(back).toBeEnabled();
      await back.click();
      await expect(p.getByRole('dialog')).toBeVisible();
    },
  },
];
export async function openState(
  page: Page,
  state: StateCase,
): Promise<Locator> {
  await page.clock.setFixedTime(new Date('2026-10-27T00:00:00Z'));
  await page.goto(state.path);
  const ready = page.locator(state.ready).first();
  await expect(ready).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await state.force?.(page);
  return ready;
}
