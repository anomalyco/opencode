import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./src/e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 300_000,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "out/playwright-report", open: "never" }]],
  use: {
    screenshot: "on",
    video: "on",
    trace: "on",
  },
  expect: {
    timeout: 30_000,
  },
})
