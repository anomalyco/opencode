import { test, expect, mock, beforeEach } from "bun:test"

const callToolOptions: Array<Record<string, unknown>> = []
const listToolsCalls: Array<string> = []

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    constructor(_url: URL, _options?: { authProvider?: unknown; requestInit?: RequestInit }) {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(_url: URL, _options?: { authProvider?: unknown; requestInit?: RequestInit }) {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    setNotificationHandler() {}
    async connect(_transport: unknown) {}
    async close() {}
    async listTools() {
      listToolsCalls.push("list")
      return {
        tools: [
          {
            name: "review",
            description: "mock review tool",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      }
    }
    async callTool(
      _params: unknown,
      _resultSchema: unknown,
      options?: Record<string, unknown>,
    ) {
      callToolOptions.push(options ?? {})
      return {
        content: [
          {
            type: "text",
            text: "ok",
          },
        ],
      }
    }
  },
}))

beforeEach(() => {
  callToolOptions.length = 0
  listToolsCalls.length = 0
})

const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

test("mcp callTool options should include progress handler and timeout reset", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-server": {
              type: "remote",
              url: "https://example.com/mcp",
              oauth: false,
              timeout: 45678,
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("test-server", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
        timeout: 45678,
      }).catch(() => {})

      const tools = await MCP.tools()
      const key = Object.keys(tools).find((item) => item.endsWith("_review"))
      expect(key).toBeDefined()

      const tool = tools[key!]
      await (tool.execute as (args: unknown) => Promise<unknown>)({})

      expect(listToolsCalls.length).toBeGreaterThan(0)
      expect(callToolOptions.length).toBe(1)
      expect(callToolOptions[0]["resetTimeoutOnProgress"]).toBe(true)
      expect(callToolOptions[0]["timeout"]).toBe(45678)
      expect(typeof callToolOptions[0]["onprogress"]).toBe("function")

      await MCP.disconnect("test-server")
    },
  })
})
