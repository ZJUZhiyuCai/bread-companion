import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.BREAD_E2E_PORT || 3211);
const baseURL = `http://127.0.0.1:${port}`;
const production = !!process.env.CI;
export default defineConfig({
  testDir: './tests/e2e', forbidOnly: !!process.env.CI, globalTimeout: 10 * 60 * 1000, timeout: 30000, fullyParallel: false, workers: 1,
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome' } }],
  // CI already built .next above. Exercise that production artifact rather than
  // introducing dev compilation / HMR delays into media and graphics deadlines.
  webServer: { command: `npm exec next ${production ? 'start' : 'dev'} -- --hostname 127.0.0.1 --port ${port}`, url: baseURL, reuseExistingServer: false, timeout: 120000, env: { BREAD_DIST_DIR: production ? '.next' : '.next-e2e', AGENT_PROVIDER: 'mock', ASR_PROVIDER: 'disabled', TTS_PROVIDER: 'disabled', MOCK_DELAY_MS: '80' } }
});
