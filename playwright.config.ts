import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 30000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3211', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: { command: 'npm exec next dev -- --hostname 127.0.0.1 --port 3211', url: 'http://127.0.0.1:3211', reuseExistingServer: false, timeout: 120000, env: { BREAD_DIST_DIR: '.next-e2e', AGENT_PROVIDER: 'mock', ASR_PROVIDER: 'disabled', TTS_PROVIDER: 'disabled', MOCK_DELAY_MS: '80' } }
});
