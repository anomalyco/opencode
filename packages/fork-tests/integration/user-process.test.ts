import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { BrokerClient } from "../../../opencode/src/auth/broker-client"
import { existsSync } from "fs"

/**
 * Integration tests for user process execution.
 *
 * REQUIREMENTS:
 * - opencode-broker must be running as root
 * - Tests must run as a user that can authenticate via PAM
 * - Socket must be accessible at default path
 *
 * Run with: sudo -E bun test packages/opencode/test/integration/user-process.test.ts
 *
 * These tests will gracefully skip when the broker is not running or not responding.
 *
 * NOTE: Some broker features (session registration, PTY operations) require
 * the latest broker version. If the running broker is outdated, tests for
 * those features will be skipped with an informational message.
 */

const SOCKET_PATH = process.platform === "darwin" ? "/var/run/opencode/auth.sock" : "/run/opencode/auth.sock"

/**
 * Check if broker is actually running by attempting a ping.
 * Socket file may exist (stale) even when broker is not running.
 */
async function checkBrokerRunning(client: BrokerClient): Promise<boolean> {
  try {
    return await client.ping()
  } catch {
    return false
  }
}

/**
 * Check if the broker supports session registration.
 * Returns true if the broker responds successfully to registerSession.
 */
async function checkSessionRegistrationSupport(client: BrokerClient): Promise<boolean> {
  try {
    const testSession = `capability-check-${Date.now()}`
    const success = await client.registerSession(testSession, {
      username: "test",
      uid: 65534, // nobody
      gid: 65534,
      home: "/tmp",
      shell: "/bin/sh",
    })
    if (success) {
      // Clean up
      await client.unregisterSession(testSession)
    }
    return success
  } catch {
    return false
  }
}

describe("User Process Execution (Integration)", () => {
  let client: BrokerClient
  let testSessionId: string
  let skipTests = true
  let sessionRegistrationSupported = false

  beforeAll(async () => {
    // First check if socket exists
    if (!existsSync(SOCKET_PATH)) {
      console.log("SKIP: Broker socket not found at", SOCKET_PATH)
      return
    }

    client = new BrokerClient()
    testSessionId = `test-${Date.now()}`

    // Verify broker is actually running (not just stale socket)
    const brokerRunning = await checkBrokerRunning(client)
    if (!brokerRunning) {
      console.log("SKIP: Broker not responding (socket exists but broker is not running)")
      return
    }

    skipTests = false
    console.log("Broker is running - integration tests will execute")

    // Check session registration support
    sessionRegistrationSupported = await checkSessionRegistrationSupport(client)
    if (!sessionRegistrationSupported) {
      console.log(
        "NOTE: Session registration not supported by running broker.",
        "Some tests will be skipped. Update broker to enable full testing.",
      )
    }
  })

  afterAll(async () => {
    // Cleanup: unregister test session if registered
    if (client && testSessionId && !skipTests && sessionRegistrationSupported) {
      try {
        await client.unregisterSession(testSessionId)
      } catch {
        // Ignore cleanup errors
      }
    }
  })

  describe("broker health", () => {
    it("should respond to ping", async () => {
      if (skipTests) {
        console.log("  - SKIPPED: broker not available")
        return
      }

      const alive = await client.ping()
      expect(alive).toBe(true)
    })
  })

  describe("session registration", () => {
    it("should register a session with user info", async () => {
      if (skipTests) {
        console.log("  - SKIPPED: broker not available")
        return
      }
      if (!sessionRegistrationSupported) {
        console.log("  - SKIPPED: session registration not supported by broker")
        return
      }

      const success = await client.registerSession(testSessionId, {
        username: process.env.USER || "nobody",
        uid: process.getuid?.() || 65534,
        gid: process.getgid?.() || 65534,
        home: process.env.HOME || "/tmp",
        shell: process.env.SHELL || "/bin/sh",
      })

      expect(success).toBe(true)
    })

    it("should allow session unregistration", async () => {
      if (skipTests) {
        console.log("  - SKIPPED: broker not available")
        return
      }
      if (!sessionRegistrationSupported) {
        console.log("  - SKIPPED: session registration not supported by broker")
        return
      }

      const tempSession = `temp-${Date.now()}`
      await client.registerSession(tempSession, {
        username: "test",
        uid: 1000,
        gid: 1000,
        home: "/home/test",
        shell: "/bin/bash",
      })

      const success = await client.unregisterSession(tempSession)
      expect(success).toBe(true)
    })

    it("should be idempotent for unregistration", async () => {
      if (skipTests) {
        console.log("  - SKIPPED: broker not available")
        return
      }
      if (!sessionRegistrationSupported) {
        console.log("  - SKIPPED: session registration not supported by broker")
        return
      }

      const tempSession = `idempotent-${Date.now()}`

      // Unregister a session that was never registered
      const success = await client.unregisterSession(tempSession)
      // Should succeed (idempotent behavior)
      expect(success).toBe(true)
    })
  })

  describe("PTY spawning", () => {
    it("should fail to spawn without registered session", async () => {
      if (skipTests) {
        console.log("  - SKIPPED: broker not available")
        return
      }
      if (!sessionRegistrationSupported) {
        console.log("  - SKIPPED: session registration not supported by broker")
        return
      }

      const result = await client.spawnPty("nonexistent-session")

      expect(result.success).toBe(false)
      // Error message varies by broker version
      expect(result.error).toBeDefined()
    })

    // Note: Full spawn tests require root broker and a registered session
    // These would need more elaborate setup in CI
  })

  describe("PTY operations", () => {
    it("should fail to resize nonexistent PTY", async () => {
      if (skipTests) {
        console.log("  - SKIPPED: broker not available")
        return
      }

      const success = await client.resizePty("nonexistent-pty", 100, 50)
      expect(success).toBe(false)
    })

    it("should fail to kill nonexistent PTY", async () => {
      if (skipTests) {
        console.log("  - SKIPPED: broker not available")
        return
      }

      const success = await client.killPty("nonexistent-pty")
      expect(success).toBe(false)
    })

    it("should fail to write to nonexistent PTY", async () => {
      if (skipTests) {
        console.log("  - SKIPPED: broker not available")
        return
      }

      const success = await client.ptyWrite("nonexistent-pty", "test")
      expect(success).toBe(false)
    })

    it("should fail to read from nonexistent PTY", async () => {
      if (skipTests) {
        console.log("  - SKIPPED: broker not available")
        return
      }

      const result = await client.ptyRead("nonexistent-pty")
      expect(result).toBeNull()
    })
  })
})
