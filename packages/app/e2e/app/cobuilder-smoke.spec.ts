import { test, expect } from "@playwright/test"
import { spawn, type ChildProcess } from "node:child_process"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import fs from "node:fs/promises"

const BINARY_PATH =
  process.env.COBUILDER_BINARY_PATH ??
  resolve(
    dirname(fileURLToPath(import.meta.url)),
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
 * Smoke test: launch the cobuilder binary, wait for the embedded web UI to be
 * reachable, then verify the root page loads in a browser.
 *
 * The binary is launched with a temporary sandbox so it doesn't touch real
 * user config. The web UI port is picked dynamically to avoid conflicts.
 */
// These tests spawn the cobuilder binary directly and require a local build.
// Skip in CI where the binary is not pre-built.
test.describe.configure({ mode: "serial" })
test.skip(!!process.env.CI, "requires a locally built cobuilder binary — not available in CI")

test.describe("cobuilder smoke", () => {
  let proc: ChildProcess | undefined
  let webPort: number
  let sandbox: string

  test.beforeAll(async () => {
    webPort = await freePort()
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "cobuilder-smoke-"))

    proc = spawn(
      BINARY_PATH,
      ["serve", "--port", String(webPort)],
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
      console.error("cobuilder process error:", err)
    })

    // Wait for the web server port to accept connections
    await waitForPort("127.0.0.1", webPort, 30_000)
  })

  test.afterAll(async () => {
    proc?.kill("SIGTERM")
    await fs.rm(sandbox, { recursive: true, force: true })
  })

  test("web UI loads at root", async ({ page }) => {
    await page.goto(`http://127.0.0.1:${webPort}/`)
    // The page should have a non-empty body — basic load check
    await expect(page.locator("body")).not.toBeEmpty()
  })

  test("page title is set", async ({ page }) => {
    await page.goto(`http://127.0.0.1:${webPort}/`)
    // Title should be present (not empty)
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)
  })

  test("no uncaught JS errors on load", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(err.message))
    await page.goto(`http://127.0.0.1:${webPort}/`)
    // Give any deferred errors a moment to surface
    await page.waitForTimeout(500)
    expect(errors).toHaveLength(0)
  })
})
