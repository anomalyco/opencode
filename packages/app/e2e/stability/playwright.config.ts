import config from "../../playwright.config"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000)

// The suite runs a production build, which answers on its own origin, so the fixtures mock that origin.
process.env.PLAYWRIGHT_SERVER_PORT = new URL(process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`).port || "80"

export default {
  ...config,
  testDir: ".",
  testMatch: "**/*.spec.ts",
  testIgnore: [],
  outputDir: "../test-results/stability",
  reporter: [["html", { outputFolder: "../playwright-report/stability", open: "never" }], ["line"]],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  webServer: config.webServer
    ? {
        ...config.webServer,
        command: `bun run build && bun e2e/utils/serve.ts --host 127.0.0.1 --port ${port}`,
        reuseExistingServer: false,
      }
    : undefined,
  use: {
    ...config.use,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
}
