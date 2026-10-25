import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000)

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`

const url = new URL(baseURL)

if (url.protocol !== "http:") throw new Error("E2E fixtures require an http:// app URL")

const built = !!process.env.CI || process.env.PLAYWRIGHT_BUILD === "1"

// Production connects to its own origin, so fixture URLs must match the static server.
if (built) {
  process.env.PLAYWRIGHT_SERVER_HOST = url.hostname
  process.env.PLAYWRIGHT_SERVER_PORT = url.port || "80"
}

const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"

const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"

const command = built
  ? `bun run build && bun e2e/utils/serve.ts --host 127.0.0.1 --port ${port}`
  : `bun run dev -- --host 127.0.0.1 --port ${port} --strictPort`

const workers = Number(process.env.PLAYWRIGHT_WORKERS ?? (process.env.CI ? 5 : 0)) || undefined

const touchScroll = /mobile-timeline-scroll\.spec\.ts/

export default defineConfig({
  testDir: "./e2e",
  testIgnore: process.env.BOLT_PERFORMANCE === "1" ? "performance/**/*.test.ts" : "performance/**",
  outputDir: "./e2e/test-results",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
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
      VITE_BOLT_SERVER_HOST: serverHost,
      VITE_BOLT_SERVER_PORT: serverPort,
    },
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // CI retries failures, so the retry records the video; local runs have no retries.
    video: process.env.CI ? "on-first-retry" : "retain-on-failure",
    // The PWA worker precaches the whole build in every test; e2e/service-worker covers it.
    serviceWorkers: "block",
  },
  // The touch-scroll project exists only for scheduling: in the chromium project, mobile-timeline-scroll
  // is one long serial group that ends up running alone on a single worker. Projects queue in
  // declaration order, so this one runs the file's tests after every chromium group, spread across all
  // workers. `--project chromium`, UI mode and the VS Code extension's default first-project selection
  // therefore skip the file.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: touchScroll,
    },
    {
      name: "chromium-touch-scroll",
      use: { ...devices["Desktop Chrome"] },
      grep: touchScroll,
      fullyParallel: true,
    },
  ],
})
