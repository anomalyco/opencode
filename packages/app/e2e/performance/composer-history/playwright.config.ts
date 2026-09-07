import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"

export default defineConfig({
  testDir: ".",
  testMatch: "composer-history.bench.ts",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: "line",
  outputDir: process.env.OPENCODE_HISTORY_OUTPUT,
  use: { baseURL: "http://127.0.0.1:4783", viewport: { width: 1440, height: 900 }, trace: "off", video: "off" },
  webServer: {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    command:
      "bun x vite preview --config e2e/performance/composer-history/vite.config.ts --host 127.0.0.1 --port 4783 --strictPort",
    url: "http://127.0.0.1:4783",
    reuseExistingServer: false,
  },
})
