import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, devices } from "@playwright/test"

const configDir = path.dirname(fileURLToPath(import.meta.url))

const portRaw = process.env.PLAYWRIGHT_PORT
const port =
  portRaw == null || portRaw === "" ? 3000 : (Number.isFinite(Number(portRaw)) && Number(portRaw) > 0)
    ? Number(portRaw)
    : 3000
const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || `http://127.0.0.1:${port}`
if (!process.env.PLAYWRIGHT_BASE_URL) {
  process.env.PLAYWRIGHT_BASE_URL = baseURL
}
const serverHost = process.env.PLAYWRIGHT_SERVER_HOST
const serverPort = process.env.PLAYWRIGHT_SERVER_PORT
if (!serverHost) throw new Error("Missing PLAYWRIGHT_SERVER_HOST")
if (!serverPort) throw new Error("Missing PLAYWRIGHT_SERVER_PORT")
const command = `bun run dev:e2e -- --host 0.0.0.0 --port ${port}`
const reuse = !process.env.CI
const defaultAuth = path.join(configDir, "../../my-auth.json")
const storageStateFile = process.env.PLAYWRIGHT_AUTH_FILE || defaultAuth
const storageState = fs.existsSync(storageStateFile) ? storageStateFile : undefined

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: process.env.PLAYWRIGHT_FULLY_PARALLEL === "1",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { outputFolder: "e2e/playwright-report", open: "never" }], ["line"]],
  webServer: {
    command,
    url: baseURL,
    reuseExistingServer: reuse,
    timeout: 120_000,
    env: {
      VITE_OPENCODE_SERVER_HOST: serverHost,
      VITE_OPENCODE_SERVER_PORT: serverPort,
      OPENCODE_WORKOS_ENABLED: "true",
    },
  },
  use: {
    baseURL,
    ...(storageState ? { storageState } : {}),
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
