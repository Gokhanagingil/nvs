import { defineConfig, devices } from '@playwright/test';
import { credentialEnvironmentVariable } from '@nvs/secret-provider-environment';

const mockNilesPort = 4310;
const apiPort = 4311;
const webPort = 4312;
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !entry[0].startsWith('NVS_CREDENTIAL_'),
  ),
);
const credentialEnvironment = Object.fromEntries(
  ['requester', 'service-desk-agent', 'incident-manager', 'tenant-admin', 'cross-tenant-agent'].map(
    (persona) => [
      credentialEnvironmentVariable(`niles.local.${persona}`),
      JSON.stringify({
        email: `${persona}@example.invalid`,
        password: 'synthetic-e2e-value',
      }),
    ],
  ),
);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  workers: 1,
  reporter: 'line',
  outputDir: 'artifacts/playwright',
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
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
      command: 'corepack pnpm exec tsx tests/fixtures/mock-niles-auth-server.ts',
      url: `http://127.0.0.1:${mockNilesPort}/health/live`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...inheritedEnvironment,
        NVS_MOCK_NILES_PORT: String(mockNilesPort),
      },
    },
    {
      command: 'corepack pnpm exec tsx tests/fixtures/start-e2e-api.ts',
      url: `http://127.0.0.1:${apiPort}/api/health/live`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...inheritedEnvironment,
        ...credentialEnvironment,
        NVS_API_PORT: String(apiPort),
        NVS_AUTHENTICATION_TIMEOUT_MS: '500',
        NVS_BUILD_SHA: 'unknown',
        NVS_BUILD_TIMESTAMP: 'unknown',
        NVS_RELEASE_VERSION: '0.1.0',
        NVS_MOCK_NILES_PORT: String(mockNilesPort),
        NVS_DATA_DIR: 'artifacts/e2e-data',
        NVS_LOG_LEVEL: 'silent',
      },
    },
    {
      command: 'corepack pnpm --filter @nvs/web dev',
      url: `http://127.0.0.1:${webPort}/scenarios`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...inheritedEnvironment,
        NVS_DEV_API_URL: `http://127.0.0.1:${apiPort}`,
        NVS_WEB_PORT: String(webPort),
      },
    },
  ],
});
