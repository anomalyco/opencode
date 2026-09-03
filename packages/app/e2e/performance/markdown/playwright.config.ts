import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"

process.env.PLAYWRIGHT_PORT = "6199"
process.env.PLAYWRIGHT_SERVER_PORT = "6199"
process.env.PLAYWRIGHT_SERVER_HOST = "127.0.0.1"

export default defineConfig({
  testDir: ".",
  testMatch: "*.bench.ts",
  outputDir: process.env.MARKDOWN_RESULTS_DIR,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["line"]],
  use: { baseURL: "http://127.0.0.1:6199", viewport: { width: 1280, height: 900 }, serviceWorkers: "block" },
  webServer: {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    command: `bun run serve -- --host 127.0.0.1 --port 6199 --strictPort --outDir "${process.env.MARKDOWN_APP_BUILD_DIR}"`,
    url: "http://127.0.0.1:6199",
    reuseExistingServer: false,
  },
})
