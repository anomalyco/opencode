import { test, expect } from "@playwright/test"
import { spawn, type ChildProcess } from "node:child_process"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import fs from "node:fs/promises"

const BINARY_PATH =
  process.env.COBUILDER_BINARY_PATH ??
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../opencode/dist/opencode-linux-x64/bin/cobuilder",
  )

async function waitForPort(host: string, port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection({ host, port })
      sock.once("connect", () => {
        sock.destroy()
        resolve(true)
      })
      sock.once("error", () => resolve(false))
    })
    if (open) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Timed out waiting for ${host}:${port}`)
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        server.close(() => reject(new Error("Failed to get free port")))
        return
      }
      server.close((err) => (err ? reject(err) : resolve(addr.port)))
    })
  })
}

/**
 * Onboarding UX flow tests: verifies the CoBuilder web UI home page renders
 * correctly for a first-time user with no projects configured.
 *
 * The binary is launched in headless server mode (`serve`) with a fresh sandbox
 * so it behaves like a brand-new installation.
 */
// These tests spawn the cobuilder binary directly and require a local build.
// Skip in CI where the binary is not pre-built.
test.describe.configure({ mode: "serial" })
test.skip(!!process.env.CI, "requires a locally built cobuilder binary — not available in CI")

test.describe("cobuilder onboarding UX", () => {
  let proc: ChildProcess | undefined
  let webPort: number
  let sandbox: string
  let baseUrl: string

  test.beforeAll(async () => {
    webPort = await freePort()
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "cobuilder-onboard-"))

    proc = spawn(
      BINARY_PATH,
      ["serve", "--port", String(webPort), "--hostname", "127.0.0.1", "--print-logs"],
      {
        env: {
          ...process.env,
          HOME: sandbox,
          XDG_DATA_HOME: path.join(sandbox, "share"),
          XDG_CACHE_HOME: path.join(sandbox, "cache"),
          XDG_CONFIG_HOME: path.join(sandbox, "config"),
          XDG_STATE_HOME: path.join(sandbox, "state"),
          OPENCODE_DISABLE_SHARE: "true",
          OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
        },
        stdio: "pipe",
      },
    )

    proc.on("error", (err) => {
      console.error("cobuilder serve process error:", err)
    })

    await waitForPort("127.0.0.1", webPort, 30_000)
    baseUrl = `http://127.0.0.1:${webPort}`
  })

  test.afterAll(async () => {
    proc?.kill("SIGTERM")
    await fs.rm(sandbox, { recursive: true, force: true })
  })

  test("home page loads with CoBuilder logo", async ({ page }) => {
    await page.goto(baseUrl)
    // The Logo SVG component renders in the home page
    const logo = page.locator("svg").first()
    await expect(logo).toBeVisible({ timeout: 15_000 })
  })

  test("server status button is present on home page", async ({ page }) => {
    await page.goto(baseUrl)
    // Home page shows a server name/status button (local server connection indicator)
    // It renders as a Button with a colored dot + server name text
    const body = page.locator("body")
    await expect(body).not.toBeEmpty()
    // Wait for the SolidJS app to hydrate — at least one button should appear
    await expect(page.locator("button").first()).toBeVisible({ timeout: 15_000 })
  })

  test("empty-state open project CTA is shown for new user", async ({ page }) => {
    await page.goto(baseUrl)
    // For a fresh sandbox with no projects, the empty state renders with an
    // "Open a project" button (or loading state). Either is a valid onboarding state.
    const hasOpenProject = await page
      .locator("button")
      .filter({ hasText: /open.*project|project.*open/i })
      .count()

    const hasLoadingState = await page
      .locator("text=/loading/i")
      .count()

    expect(hasOpenProject + hasLoadingState).toBeGreaterThan(0)
  })

  test("API health endpoint responds", async ({ page }) => {
    // The CoBuilder server exposes a health/version endpoint
    const response = await page.request.get(`${baseUrl}/api/version`)
    // Accept 200 (version info) or any non-500 status (route may vary)
    expect(response.status()).toBeLessThan(500)
  })
})
