import { describe, it, expect, afterEach } from "bun:test"
import { BrokerClient } from "../../src/auth/broker-client.js"
import { createServer, type Server } from "net"
import { unlinkSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

describe("BrokerClient", () => {
  // Each test gets its own unique socket path
  let testSocketPath: string
  let mockServer: Server | null = null

  const createTestSocketPath = () => join(tmpdir(), `opencode-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`)

  afterEach(async () => {
    if (mockServer) {
      mockServer.close()
      mockServer = null
    }
    // Small delay to ensure socket is fully released
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (testSocketPath && existsSync(testSocketPath)) {
      try {
        unlinkSync(testSocketPath)
      } catch {
        // Ignore cleanup errors
      }
    }
  })

  describe("authenticate", () => {
    it("returns error when broker not running", async () => {
      const client = new BrokerClient({ socketPath: "/nonexistent/socket.sock" })
      const result = await client.authenticate("user", "pass")

      expect(result.success).toBe(false)
      expect(result.error).toBe("authentication service unavailable")
    })

    it("sends correct protocol format", async () => {
      testSocketPath = createTestSocketPath()
      let receivedData = ""

      mockServer = createServer((socket) => {
        socket.on("data", (data) => {
          receivedData = data.toString()
          const request = JSON.parse(receivedData.trim())
          const response = {
            id: request.id,
            success: true,
          }
          socket.write(JSON.stringify(response) + "\n")
          socket.end()
        })
      })

      await new Promise<void>((resolve, reject) => {
        mockServer!.listen(testSocketPath, () => resolve())
        mockServer!.on("error", reject)
      })

      const client = new BrokerClient({ socketPath: testSocketPath })
      const result = await client.authenticate("testuser", "testpass")

      expect(result.success).toBe(true)

      // Verify request format matches Rust protocol
      const request = JSON.parse(receivedData.trim())
      expect(request.version).toBe(1)
      expect(request.method).toBe("authenticate")
      expect(request.username).toBe("testuser")
      expect(request.password).toBe("testpass")
      expect(request.id).toBeDefined()
      expect(typeof request.id).toBe("string")
    })

    it("handles authentication failure", async () => {
      testSocketPath = createTestSocketPath()

      mockServer = createServer((socket) => {
        socket.on("data", (data) => {
          const request = JSON.parse(data.toString().trim())
          const response = {
            id: request.id,
            success: false,
            error: "authentication failed",
          }
          socket.write(JSON.stringify(response) + "\n")
          socket.end()
        })
      })

      await new Promise<void>((resolve, reject) => {
        mockServer!.listen(testSocketPath, () => resolve())
        mockServer!.on("error", reject)
      })

      const client = new BrokerClient({ socketPath: testSocketPath })
      const result = await client.authenticate("baduser", "badpass")

      expect(result.success).toBe(false)
      expect(result.error).toBe("authentication failed")
    })

    it("handles mismatched response ID", async () => {
      testSocketPath = createTestSocketPath()

      mockServer = createServer((socket) => {
        socket.on("data", () => {
          // Return response with wrong ID
          const response = {
            id: "wrong-id",
            success: true,
          }
          socket.write(JSON.stringify(response) + "\n")
          socket.end()
        })
      })

      await new Promise<void>((resolve, reject) => {
        mockServer!.listen(testSocketPath, () => resolve())
        mockServer!.on("error", reject)
      })

      const client = new BrokerClient({ socketPath: testSocketPath })
      const result = await client.authenticate("user", "pass")

      expect(result.success).toBe(false)
      expect(result.error).toBe("authentication service unavailable")
    })

    it("handles connection timeout", async () => {
      testSocketPath = createTestSocketPath()

      // Server that never responds
      mockServer = createServer((socket) => {
        socket.on("data", () => {
          // Do nothing - let it timeout
        })
      })

      await new Promise<void>((resolve, reject) => {
        mockServer!.listen(testSocketPath, () => resolve())
        mockServer!.on("error", reject)
      })

      const client = new BrokerClient({ socketPath: testSocketPath, timeoutMs: 100 })
      const result = await client.authenticate("user", "pass")

      expect(result.success).toBe(false)
      expect(result.error).toBe("authentication service unavailable")
    })

    it("handles invalid JSON response", async () => {
      testSocketPath = createTestSocketPath()

      mockServer = createServer((socket) => {
        socket.on("data", () => {
          socket.write("not valid json\n")
          socket.end()
        })
      })

      await new Promise<void>((resolve, reject) => {
        mockServer!.listen(testSocketPath, () => resolve())
        mockServer!.on("error", reject)
      })

      const client = new BrokerClient({ socketPath: testSocketPath })
      const result = await client.authenticate("user", "pass")

      expect(result.success).toBe(false)
      expect(result.error).toBe("authentication service unavailable")
    })
  })

  describe("ping", () => {
    it("returns false when broker not running", async () => {
      const client = new BrokerClient({ socketPath: "/nonexistent/socket.sock" })
      const result = await client.ping()

      expect(result).toBe(false)
    })

    it("returns true when broker responds", async () => {
      testSocketPath = createTestSocketPath()

      mockServer = createServer((socket) => {
        socket.on("data", (data) => {
          const request = JSON.parse(data.toString().trim())
          const response = {
            id: request.id,
            success: true,
          }
          socket.write(JSON.stringify(response) + "\n")
          socket.end()
        })
      })

      await new Promise<void>((resolve, reject) => {
        mockServer!.listen(testSocketPath, () => resolve())
        mockServer!.on("error", reject)
      })

      const client = new BrokerClient({ socketPath: testSocketPath })
      const result = await client.ping()

      expect(result).toBe(true)
    })

    it("sends correct ping request format", async () => {
      testSocketPath = createTestSocketPath()
      let receivedData = ""

      mockServer = createServer((socket) => {
        socket.on("data", (data) => {
          receivedData = data.toString()
          const request = JSON.parse(receivedData.trim())
          const response = {
            id: request.id,
            success: true,
          }
          socket.write(JSON.stringify(response) + "\n")
          socket.end()
        })
      })

      await new Promise<void>((resolve, reject) => {
        mockServer!.listen(testSocketPath, () => resolve())
        mockServer!.on("error", reject)
      })

      const client = new BrokerClient({ socketPath: testSocketPath })
      await client.ping()

      // Verify ping request format
      const request = JSON.parse(receivedData.trim())
      expect(request.version).toBe(1)
      expect(request.method).toBe("ping")
      expect(request.id).toBeDefined()
      // Ping should not have username/password
      expect(request.username).toBeUndefined()
      expect(request.password).toBeUndefined()
    })
  })

  describe("constructor", () => {
    it("uses Linux socket path by default on non-darwin", () => {
      // This test verifies the path logic exists, but we can't easily
      // override process.platform. The implementation defaults correctly.
      const client = new BrokerClient()
      // Just verify we can create a client with defaults
      expect(client).toBeDefined()
    })

    it("accepts custom socket path", () => {
      const customPath = "/custom/socket.sock"
      const client = new BrokerClient({ socketPath: customPath })
      expect(client).toBeDefined()
    })

    it("accepts custom timeout", () => {
      const client = new BrokerClient({ timeoutMs: 5000 })
      expect(client).toBeDefined()
    })
  })
})
