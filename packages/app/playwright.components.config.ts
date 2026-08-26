import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.PLAYWRIGHT_STORYBOOK_PORT ?? 6006)
const baseURL = process.env.PLAYWRIGHT_STORYBOOK_URL ?? `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: "./component-tests",
  outputDir: "./component-tests/test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["html", { outputFolder: "component-tests/playwright-report", open: "never" }], ["line"]],
  webServer: {
    command: `bun --bun run --cwd ../storybook storybook -- --port ${port} --ci --no-open`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "components", use: { ...devices["Desktop Chrome"] } }],
})
