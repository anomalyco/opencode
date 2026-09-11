import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"

export default defineConfig({
  testDir: ".",
  testMatch: "*.bench.ts",
  outputDir: process.env.MARKDOWN_RESULTS_DIR,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["line"]],
  use: { baseURL: "http://127.0.0.1:6197", viewport: { width: 1280, height: 900 } },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command:
      "bun --bun x vite preview --config performance/markdown-lifetime/vite.config.ts --host 127.0.0.1 --port 6197 --strictPort",
    url: "http://127.0.0.1:6197",
    reuseExistingServer: false,
  },
})
