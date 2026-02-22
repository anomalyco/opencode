import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Network } from "../../src/util/network"
import fs from "fs"
import path from "path"

const LOG_FILE = path.join(process.cwd(), ".opencode", "network-test-failures.log")

function logFailure(message: string) {
  const dir = path.dirname(LOG_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const entry = `[${new Date().toISOString()}] ${message}\n`
  fs.appendFileSync(LOG_FILE, entry)
}

describe("util.network", () => {
  beforeEach(() => {
    Network.disable()
    Network.clearHistory()
  })

  afterEach(() => {
    Network.disable()
  })

  test("should initialize and enable filter", () => {
    Network.init()
    const enabled = Network.isEnabled()
    if (!enabled) logFailure("Network filter failed to initialize")
    expect(enabled).toBe(true)
  })

  test("should block requests to blocked domains", async () => {
    Network.init()

    let blocked = false
    try {
      await fetch("https://api.opencode.ai/test")
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("blocked")) blocked = true
    }

    if (!blocked) logFailure("Failed to block request to api.opencode.ai")
    expect(blocked).toBe(true)
  })

  test("should record blocked requests in history", async () => {
    Network.init()

    try {
      await fetch("https://opencode.ai/test")
    } catch {
      // Expected
    }

    const blockedRequests = Network.getBlockedRequests()
    if (blockedRequests.length === 0) logFailure("Blocked request not recorded in history")
    expect(blockedRequests.length).toBeGreaterThan(0)
    expect(blockedRequests[0].blocked).toBe(true)
  })

  test("should capture stack trace only for blocked requests", async () => {
    Network.init()

    // Blocked request should have stack
    try {
      await fetch("https://api.opencode.ai/test")
    } catch {
      // Expected
    }

    const blocked = Network.getBlockedRequests()
    if (!blocked[0]?.stack) logFailure("Stack trace not captured for blocked request")
    expect(blocked[0]?.stack).toBeDefined()
  })

  test("should allow non-blocked domains", async () => {
    Network.init()

    // Use a local server to avoid external dependencies
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok")
      },
    })

    let success = false
    try {
      const resp = await fetch(`http://localhost:${server.port}/test`)
      success = resp.ok
    } catch (e) {
      logFailure(`Non-blocked request failed: ${e}`)
    } finally {
      server.stop()
    }

    expect(success).toBe(true)
  })

  test("should not capture stack trace for allowed requests", async () => {
    Network.init()

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok")
      },
    })

    try {
      await fetch(`http://localhost:${server.port}/test`)
    } finally {
      server.stop()
    }

    const history = Network.getHistory()
    const allowed = history.find((r) => !r.blocked)
    if (allowed?.stack) logFailure("Stack trace captured for allowed request (performance issue)")
    expect(allowed?.stack).toBeUndefined()
  })

  test("should disable filter correctly", () => {
    Network.init()
    expect(Network.isEnabled()).toBe(true)

    Network.disable()
    const disabled = !Network.isEnabled()
    if (!disabled) logFailure("Network filter failed to disable")
    expect(disabled).toBe(true)
  })
})
