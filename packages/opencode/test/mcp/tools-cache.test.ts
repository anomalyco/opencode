import { test, expect, beforeEach, mock } from "bun:test"

let listToolsCalls = 0
let listToolsResponses: Array<
  Array<{
    name: string
    description?: string
    inputSchema: Record<string, unknown>
  }>
> = []

class MockClient {
  async connect() {
    return
  }

  async close() {
    return
  }

  setNotificationHandler() {
    return
  }

  async listTools() {
    const tools = listToolsResponses[listToolsCalls] ?? []
    listToolsCalls += 1
    return { tools }
  }

  async callTool() {
    throw new Error("not implemented")
  }
}

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}))

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    constructor() {
      return
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor() {
      return
    }
  },
}))

beforeEach(() => {
  listToolsCalls = 0
  listToolsResponses = []
})

const { MCP } = await import("../../src/mcp/index")
const { Bus } = await import("../../src/bus")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

test("MCP.tools caches listTools and invalidates on ToolsChanged", async () => {
  listToolsResponses = [
    [
      {
        name: "alpha",
        description: "alpha tool",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    [
      {
        name: "beta",
        description: "beta tool",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  ]

  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("test", {
        type: "remote",
        url: "https://example.com/mcp",
      })

      // Ignore the listTools call in create()
      listToolsCalls = 0

      const tools1 = await MCP.tools()
      expect(listToolsCalls).toBe(1)
      expect(Object.keys(tools1)).toEqual(["test_alpha"])

      const tools2 = await MCP.tools()
      expect(listToolsCalls).toBe(1)
      expect(Object.keys(tools2)).toEqual(["test_alpha"])

      await Bus.publish(MCP.ToolsChanged, { server: "test" })

      const tools3 = await MCP.tools()
      expect(listToolsCalls).toBe(2)
      expect(Object.keys(tools3)).toEqual(["test_beta"])

      await Instance.dispose()
    },
  })
})

test("MCP.tools caches empty tools as valid", async () => {
  listToolsResponses = [[]]

  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("empty", {
        type: "remote",
        url: "https://example.com/mcp",
      })

      // Ignore the listTools call in create()
      listToolsCalls = 0

      const tools1 = await MCP.tools()
      expect(listToolsCalls).toBe(1)
      expect(Object.keys(tools1)).toEqual([])

      const tools2 = await MCP.tools()
      expect(listToolsCalls).toBe(1)
      expect(Object.keys(tools2)).toEqual([])

      await Instance.dispose()
    },
  })
})
