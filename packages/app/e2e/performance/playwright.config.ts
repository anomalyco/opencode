import config from "../../playwright.config"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000)
process.env.PLAYWRIGHT_SERVER_PORT = new URL(process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`).port || "80"
process.env.OPENCODE_PERFORMANCE_RUN_ID ??= `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`

export default {
  ...config,
  testDir: ".",
  testIgnore: ["unit/**", "devex/**"],
  outputDir: "../test-results/performance",
  fullyParallel: false,
  workers: 1,
  reporter: [["html", { outputFolder: "../playwright-report/performance", open: "never" }], ["line"]],
  webServer: config.webServer
    ? {
        ...config.webServer,
        command: `bun run build && bun run serve -- --host 0.0.0.0 --port ${port} --strictPort`,
        reuseExistingServer: false,
      }
    : undefined,
}
