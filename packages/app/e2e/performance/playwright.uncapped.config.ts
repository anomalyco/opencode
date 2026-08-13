import config from "./playwright.config"

export default {
  ...config,
  outputDir: "../test-results/performance-uncapped",
  reporter: [["html", { outputFolder: "../playwright-report/performance-uncapped", open: "never" }], ["line"]],
  use: {
    ...config.use,
    launchOptions: {
      args: ["--disable-frame-rate-limit", "--disable-gpu-vsync"],
    },
  },
}
