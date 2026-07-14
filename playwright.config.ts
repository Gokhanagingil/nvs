import { defineConfig, devices } from '@playwright/test';

const reuseExistingServer = !process.env['CI'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  workers: 1,
  reporter: 'line',
  outputDir: 'artifacts/playwright',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'corepack pnpm --filter @nvs/api dev',
      url: 'http://127.0.0.1:4100/api/health',
      reuseExistingServer,
      timeout: 120_000,
    },
    {
      command: 'corepack pnpm --filter @nvs/web dev',
      url: 'http://127.0.0.1:4173/scenarios',
      reuseExistingServer,
      timeout: 120_000,
    },
  ],
});
