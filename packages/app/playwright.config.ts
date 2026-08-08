import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
const command = `bun run dev -- --host 0.0.0.0 --port ${port}`
const reuse = !process.env.CI
const workers = Number(process.env.PLAYWRIGHT_WORKERS ?? (process.env.CI ? 5 : 0)) || undefined
export default defineConfig({
  testDir: "./e2e",
  testIgnore: process.env.OPENCODE_PERFORMANCE === "1" ? "performance/**/*.test.ts" : "performance/**",
  outputDir: "./e2e/test-results",
  timeout: 60_000,
  expect: {
    // Default is 10s. On slow Windows CI runners, rendering content
    // (review panel diffs, file projections, patches) can exceed 10s and
    // flake as `toBeVisible` "element(s) not found". Widen the margin in CI
    // only (same approach as #74's timing fixes); local runs keep 10s so
    // genuine regressions still surface fast. Test timeout is 60s.
    timeout: process.env.CI ? 30_000 : 10_000,
  },
  fullyParallel: process.env.PLAYWRIGHT_FULLY_PARALLEL === "1",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers,
  reporter: [["html", { outputFolder: "e2e/playwright-report", open: "never" }], ["line"]],
  webServer: {
    command,
    url: baseURL,
    reuseExistingServer: reuse,
    timeout: 120_000,
    env: {
      VITE_OPENCODE_SERVER_HOST: serverHost,
      VITE_OPENCODE_SERVER_PORT: serverPort,
    },
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
