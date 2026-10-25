import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: "composer-images.bench.ts",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: "line",
  outputDir: process.env.OPENCODE_IMAGE_OUTPUT,
  use: {
    channel: "chrome",
    baseURL: process.env.OPENCODE_IMAGE_URL ?? "http://127.0.0.1:4784",
    viewport: { width: 1440, height: 900 },
    trace: "off",
    video: "off",
  },
})
