import { expect, test } from '@playwright/test';
const snapshot = {
  status: 'warming',
  project: {
    id: 'test',
    version: 0,
    fps: 30,
    width: 1920,
    height: 1080,
    duration: 0,
    tracks: [],
    clips: {},
    markers: [],
  },
  assets: [],
  wsUrl: 'ws://warmup.test/session',
};
test('phase 4 real event mapping, typed label, cancel and delayed warning', async ({
  page,
}) => {
  await page.clock.install();
  await page.route('**/v1/sessions/test', (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.routeWebSocket('ws://warmup.test/session', (socket) => {
    socket.send(JSON.stringify({ t: 'warmup.step', step: 'watch', pct: 0.5 }));
    socket.send(
      JSON.stringify({
        t: 'agent.status',
        state: 'thinking',
        label: 'found speech in the podcast clip',
      }),
    );
  });
  await page.goto('/warmup/test');
  await expect(
    page.locator('.warmup-steps [data-status=active]'),
  ).toContainText('watching your footage');
  await page.clock.fastForward(1000);
  await expect(page.locator('.warmup-noticed')).toContainText(
    'found speech in the podcast clip',
  );
  await page.getByRole('button', { name: 'cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('stop this edit?');
  await page.getByRole('button', { name: 'keep going', exact: true }).click();
  await page.clock.fastForward(60000);
  await expect(page.locator('.warmup-bottom')).toHaveText(
    'taking longer than usual, big files take a moment',
  );
});
test('phase 4 reduced-motion labels stay honest before fallback', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.route('**/v1/sessions/test', (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.routeWebSocket('ws://warmup.test/session', (socket) =>
    socket.send(JSON.stringify({ t: 'warmup.step', step: 'watch', pct: 0 })),
  );
  await page.goto('/warmup/test');
  await expect(page.locator('.warmup-noticed')).toBeEmpty();
  await page.clock.fastForward(4100);
  await expect(page.locator('.warmup-noticed')).toContainText(
    'reading every frame…',
  );
});
