import { beforeEach, expect, mock, test } from "bun:test"

let calls = 0

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect(_transport: unknown) {}
    async close() {}
    async listTools() {
      return { tools: [] }
    }
    async listPrompts() {
      calls += 1
      throw new Error("MCP error -32601: Method not found: prompts/list")
    }
    setNotificationHandler() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    constructor(_url: URL, _options?: unknown) {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(_url: URL, _options?: unknown) {}
  },
}))

const { MCP } = await import("../../src/mcp/index")
const { AppRuntime } = await import("../../src/effect/app-runtime")
const { InstanceStore } = await import("../../src/project/instance-store")
const { tmpdir } = await import("../fixture/fixture")

beforeEach(() => {
  calls = 0
})

test("skips clients that do not support prompts/list", async () => {
  await using tmp = await tmpdir({
    config: {
      mcp: {
        ace: {
          type: "remote",
          url: "https://example.com/mcp",
        },
      },
    },
  })

  const readPrompts = () =>
    AppRuntime.runPromise(
      InstanceStore.Service.use((store) =>
        store.provide(
          { directory: tmp.path },
          MCP.Service.use((mcp) => mcp.prompts()),
        ),
      ),
    )

  expect(await readPrompts()).toEqual({})
  expect(await readPrompts()).toEqual({})
  expect(calls).toBe(2)
})
