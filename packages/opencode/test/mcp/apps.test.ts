import { test, expect, mock, beforeEach } from "bun:test"

const toolsResult = {
  tools: [
    {
      name: "show_dashboard",
      description: "Show an interactive dashboard",
      inputSchema: { type: "object" as const, properties: {} },
      _meta: { ui: { resourceUri: "ui://my-server/dashboard.html", maxHeight: 800 } },
    },
    {
      name: "app_only_tool",
      description: "Only callable by the app, not the model",
      inputSchema: { type: "object" as const, properties: {} },
      _meta: { ui: { resourceUri: "ui://my-server/app.html", visibility: ["app"] } },
    },
    {
      name: "plain_tool",
      description: "No UI resource",
      inputSchema: { type: "object" as const, properties: {} },
    },
  ],
}

const resourceHtml = "<html><body>app</body></html>"

let mockListTools: ReturnType<typeof mock>
let mockReadResource: ReturnType<typeof mock>
let mockConnect: ReturnType<typeof mock>

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect() {}
    async close() {}
    listTools() {
      return mockListTools()
    }
    readResource(_: { uri: string }) {
      return mockReadResource(_)
    }
    setNotificationHandler() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdio {
    stderr = { on: () => {} }
    async start() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    async start() {
      throw new Error("mock")
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    async start() {
      throw new Error("mock")
    }
  },
}))

beforeEach(() => {
  mockListTools = mock(() => Promise.resolve(toolsResult))
  mockReadResource = mock(({ uri }: { uri: string }) =>
    Promise.resolve({
      contents: [{ uri, mimeType: "text/html;profile=mcp-app", text: resourceHtml }],
    }),
  )
  mockConnect = mock(async () => {})
})

const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

test("toolMeta returns app metadata for tools with _meta.ui.resourceUri", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("my_server", { type: "local", command: ["echo"] }).catch(() => {})
      await MCP.tools()
      const meta = MCP.toolMeta("my_server_show_dashboard")
      expect(meta).toBeDefined()
      expect(meta!.resourceUri).toBe("ui://my-server/dashboard.html")
    },
  })
})

test("tools() excludes app-only tools from the model's tool list", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("my_server", { type: "local", command: ["echo"] }).catch(() => {})
      const tools = await MCP.tools()
      expect(tools["my_server_show_dashboard"]).toBeDefined()
      expect(tools["my_server_plain_tool"]).toBeDefined()
      expect(tools["my_server_app_only_tool"]).toBeUndefined()
    },
  })
})

test("toolMeta returns visibility for app-only tools", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("my_server", { type: "local", command: ["echo"] }).catch(() => {})
      await MCP.tools()
      const meta = MCP.toolMeta("my_server_app_only_tool")
      expect(meta).toBeDefined()
      expect(meta!.visibility).toEqual(["app"])
    },
  })
})

test("apps() returns tools with ui resource metadata", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("my_server", { type: "local", command: ["echo"] }).catch(() => {})
      const result = await MCP.apps()
      expect(result["my_server_show_dashboard"]).toBeDefined()
      expect(result["my_server_show_dashboard"].resourceUri).toBe("ui://my-server/dashboard.html")
      expect(result["my_server_show_dashboard"].server).toBe("my_server")
    },
  })
})

test("appResource fetches and caches HTML for a ui:// URI", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("my_server", { type: "local", command: ["echo"] }).catch(() => {})
      const resource = await MCP.appResource("my_server", "ui://my-server/dashboard.html")
      expect(resource).toBeDefined()
      expect(resource!.html).toBe(resourceHtml)
      expect(resource!.server).toBe("my_server")
      expect(mockReadResource).toHaveBeenCalledTimes(1)

      const again = await MCP.appResource("my_server", "ui://my-server/dashboard.html")
      expect(again!.html).toBe(resourceHtml)
      expect(mockReadResource).toHaveBeenCalledTimes(1)
    },
  })
})

test("toolMeta returns maxHeight when declared in _meta.ui", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("my_server", { type: "local", command: ["echo"] }).catch(() => {})
      await MCP.tools()
      const meta = MCP.toolMeta("my_server_show_dashboard")
      expect(meta).toBeDefined()
      expect(meta!.maxHeight).toBe(800)
    },
  })
})
