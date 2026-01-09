import { test, expect, beforeEach, mock } from "bun:test"

// Track spawned transports for verification
let mockPid = 12345
const mockTransports: Array<{
  pid: number | null
}> = []

// Track client.close() calls
const clientCloseCallCount = { value: 0 }

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdioTransport {
    private _pid: number | null = mockPid++

    constructor(_options: unknown) {
      mockTransports.push({ pid: this._pid })
    }

    get pid() {
      return this._pid
    }

    async start() {}
    async close() {}

    onmessage?: (message: unknown) => void
    onerror?: (error: Error) => void
    onclose?: () => void

    send(_message: unknown) {
      return Promise.resolve()
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect(_transport: unknown) {}
    async close() {
      clientCloseCallCount.value++
    }
    async listTools() {
      return { tools: [] }
    }
    setNotificationHandler() {}
  },
}))

beforeEach(() => {
  mockTransports.length = 0
  mockPid = 12345
  clientCloseCallCount.value = 0
})

// Import after mocking
const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

test("local MCP server transport is created with PID tracking", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("test-server", {
        type: "local",
        command: ["echo", "test"],
      })

      // Transport should be created with a PID
      expect(mockTransports.length).toBe(1)
      expect(mockTransports[0].pid).toBe(12345)
    },
  })
})

test("multiple local servers each get unique PID tracking", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("server-1", { type: "local", command: ["cmd1"] })
      await MCP.add("server-2", { type: "local", command: ["cmd2"] })
      await MCP.add("server-3", { type: "local", command: ["cmd3"] })

      expect(mockTransports.length).toBe(3)

      // Each has unique PID
      const pids = mockTransports.map((t) => t.pid)
      expect(new Set(pids).size).toBe(3)
    },
  })
})

test("MCP.disconnect calls client.close()", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("test-server", {
        type: "local",
        command: ["echo", "test"],
      })

      expect(clientCloseCallCount.value).toBe(0)

      await MCP.disconnect("test-server")

      // client.close() should have been called
      expect(clientCloseCallCount.value).toBe(1)
    },
  })
})

test("MCP.connect also creates transport with PID tracking", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "configured-server": {
              type: "local",
              command: ["echo", "test"],
              enabled: false,
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Initially no transports (server is disabled)
      expect(mockTransports.length).toBe(0)

      // Connect creates transport
      await MCP.connect("configured-server")

      expect(mockTransports.length).toBe(1)
      expect(mockTransports[0].pid).toBe(12345)
    },
  })
})
