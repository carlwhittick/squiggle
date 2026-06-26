import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    headless: true,
    viewport: { width: 2400, height: 600 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ?? '/etc/profiles/per-user/carlw/bin/chromium',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
