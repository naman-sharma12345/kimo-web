import { defineConfig } from '@playwright/test';

// AUTHORED ONLY: no webServer, installation, baseline update or browser launch in authoring.
// Channel projects require installed branded browsers on a separately authorized runner.
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'edge', use: { browserName: 'chromium', channel: 'msedge' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit-surrogate-not-safari', use: { browserName: 'webkit' } },
  ],
  snapshotPathTemplate:
    '{testDir}/baselines/{projectName}/{testFilePath}/{arg}{ext}',
  updateSnapshots: 'none',
  expect: {
    timeout: 10000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixels: 0,
    },
  },
  retries: 0,
  workers: 1,
});
