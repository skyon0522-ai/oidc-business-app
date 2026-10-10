import { defineConfig, devices } from '@playwright/test'
import { APP_URL } from './support/common.ts'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['line']],
  projects: [{ name: 'Chromium local Keycloak', use: { ...devices['Desktop Chrome'], baseURL: APP_URL.origin } }],
  webServer: {
    command: 'node server/app.js',
    cwd: '..',
    url: `${APP_URL.origin}/healthz`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
