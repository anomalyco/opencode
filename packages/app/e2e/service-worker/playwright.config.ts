import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../test-results/service-worker",
  timeout: 30_000,
  use: { browserName: "chromium" },
})
