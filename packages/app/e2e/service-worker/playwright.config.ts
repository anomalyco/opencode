import { defineConfig } from "@playwright/test"

// Tiny fixture builds do not need a Rolldown thread for every host CPU.
process.env.RAYON_NUM_THREADS ??= "2"

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../test-results/service-worker",
  timeout: 60_000,
  workers: 1,
  expect: { timeout: 15_000 },
  use: { browserName: "chromium" },
})
