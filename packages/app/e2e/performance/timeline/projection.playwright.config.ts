import config from "../playwright.config"

export default {
  ...config,
  testDir: ".",
  testMatch: "timeline-projection-benchmark.spec.ts",
  outputDir: process.env.PROJECTION_OUTPUT,
  webServer: {
    ...config.webServer,
    command: `bun run serve -- --host 127.0.0.1 --port ${process.env.PLAYWRIGHT_PORT ?? 3000} --strictPort --outDir ${process.env.PROJECTION_BUNDLE ?? "dist"}`,
    url: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 3000}`,
    reuseExistingServer: false,
  },
  use: { ...config.use, video: "off" as const, trace: "off" as const },
}
