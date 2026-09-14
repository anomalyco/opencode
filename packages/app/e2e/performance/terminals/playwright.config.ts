import { defineConfig } from "@playwright/test"
import config from "../../../playwright.config"

export default defineConfig({
  ...config,
  testDir: ".",
  testIgnore: [],
  testMatch: "terminal-benchmark.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  outputDir: process.env.TERMINAL_RESULTS,
  reporter: [["line"]],
  webServer: {
    command: `bun x vite preview --host 127.0.0.1 --port ${new URL(process.env.PLAYWRIGHT_BASE_URL!).port} --strictPort --outDir ${process.env.TERMINAL_BUILD}`,
    url: process.env.PLAYWRIGHT_BASE_URL,
    reuseExistingServer: false,
  },
  use: { ...config.use, viewport: { width: 1440, height: 900 }, trace: "off", video: "off", serviceWorkers: "block" },
})
