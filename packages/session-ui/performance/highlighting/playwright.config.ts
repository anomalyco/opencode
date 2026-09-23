import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".", testMatch: process.env.HIGHLIGHT_CORRECTNESS ? "*.correctness.ts" : "*.bench.ts", workers: 1, retries: 0, maxFailures: 1, timeout: 120_000,
  outputDir: process.env.HIGHLIGHT_RESULTS,
  reporter: [["line"]],
  use: { baseURL: `http://127.0.0.1:${process.env.HIGHLIGHT_PORT ?? 4793}`, viewport: { width: 1280, height: 800 } },
  webServer: {
    command: "bun serve.ts",
    url: `http://127.0.0.1:${process.env.HIGHLIGHT_PORT ?? 4793}`,
    reuseExistingServer: false,
  },
})
