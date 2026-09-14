import { defineConfig } from "@playwright/test"

const baseURL = `http://127.0.0.1:${process.env.PATCH_PORT ?? 4317}`
export default defineConfig({
  testDir: ".",
  testMatch: "*.bench.ts",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: process.env.PATCH_RESULTS_DIR,
  reporter: "line",
  use: { baseURL, viewport: { width: 1366, height: 768 }, colorScheme: "light" },
  webServer: {
    command: "bun serve.ts",
    url: baseURL,
    reuseExistingServer: false,
  },
})
