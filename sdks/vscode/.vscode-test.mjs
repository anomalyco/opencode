import { defineConfig } from "@vscode/test-cli"

export default defineConfig([
  {
    label: "e2e-stable",
    files: "out/test/e2e/**/*.test.js",
    version: "stable",
    launchArgs: ["--enable-proposed-api=sst-dev.opencode", "--verbose"],
    mocha: {
      ui: "tdd",
      timeout: 60000,
      reporter: "mochawesome",
      require: ["./out/test/bootstrap.js"],
      reporterOptions: {
        reportDir: "test-results",
        reportFilename: "e2e-report",
        overwrite: true,
        html: true,
        json: true,
      },
    },
  },
  {
    label: "e2e-insiders",
    files: "out/test/e2e/**/*.test.js",
    version: "insiders",
    launchArgs: ["--enable-proposed-api=sst-dev.opencode", "--verbose"],
    mocha: {
      ui: "tdd",
      timeout: 60000,
      reporter: "mochawesome",
      require: ["./out/test/bootstrap.js"],
      reporterOptions: {
        reportDir: "test-results",
        reportFilename: "e2e-report",
        overwrite: true,
        html: true,
        json: true,
      },
    },
  },
])
