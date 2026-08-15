import { defineConfig } from "@playwright/test"

process.env.OPENCODE_PERFORMANCE_RUN_ID ??= `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`

export default defineConfig({
  testDir: ".",
  testMatch: "desktop-startup-benchmark.spec.ts",
  outputDir: "../../test-results/performance-devex",
  timeout: 15 * 60_000,
  expect: {
    timeout: 120_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["html", { outputFolder: "../../playwright-report/performance-devex", open: "never" }], ["line"]],
  projects: [{ name: "desktop" }],
})
