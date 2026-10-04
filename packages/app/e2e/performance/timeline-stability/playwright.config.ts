import config from "../playwright.config"

export default {
  ...config,
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "../../test-results/timeline-stability",
  reporter: [["html", { outputFolder: "../../playwright-report/timeline-stability", open: "never" }], ["line"]],
  retries: 0,
  workers: 1,
  use: {
    ...config.use,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
}
