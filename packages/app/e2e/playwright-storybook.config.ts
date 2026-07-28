import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./",
  testMatch: "storybook-smoke.spec.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [["line"]],
  use: { trace: "on-first-retry", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
