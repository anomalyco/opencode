import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.PLAYWRIGHT_TIMELINE_SUSPENSE_PORT ?? 4317)

export default defineConfig({
  testDir: ".",
  testMatch: "timeline-suspense.repro.ts",
  outputDir: "../../test-results/timeline-suspense",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  webServer: {
    command: `bunx vite --config vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: import.meta.dirname,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
