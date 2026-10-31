import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: "desktop-startup.spec.ts",
  outputDir: "../test-results/devex",
  timeout: 15 * 60_000,
  expect: {
    timeout: 120_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["html", { outputFolder: "../playwright-report/devex", open: "never" }], ["line"]],
  projects: [{ name: "desktop" }],
})
