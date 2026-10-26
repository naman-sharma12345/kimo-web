import type { Page } from '@playwright/test';
/** Deterministic screenshot fixture only. The real WS stream has separate CLI tests. */
export async function installWarmupPreview(page: Page) {
  await page.route('**/v1/sessions/preview', (route) =>
    route.fulfill({
      json: {
        status: 'warming',
        project: {
          id: 'preview',
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
        wsUrl: 'ws://preview.kimo.test/live',
      },
    }),
  );
  await page.routeWebSocket('ws://preview.kimo.test/live', (socket) => {
    socket.send(JSON.stringify({ t: 'warmup.step', step: 'watch', pct: 0.5 }));
    socket.send(
      JSON.stringify({
        t: 'agent.status',
        state: 'thinking',
        label: 'reading every frame…',
      }),
    );
  });
}
