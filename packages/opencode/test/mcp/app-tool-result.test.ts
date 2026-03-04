import { describe, test, expect, mock } from "bun:test"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const structuredPayload = { dashboard: { value: 42 } }

const toolsResult = {
  tools: [
    {
      name: "show_chart",
      description: "Show a chart",
      inputSchema: { type: "object" as const, properties: {} },
      _meta: { ui: { resourceUri: "ui://charts/chart.html" } },
    },
  ],
}

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect() {}
    async close() {}
    listTools() {
      return Promise.resolve(toolsResult)
    }
    callTool() {
      return Promise.resolve({
        content: [{ type: "text", text: "chart rendered" }],
        structuredContent: structuredPayload,
      })
    }
    readResource() {
      return Promise.resolve({
        contents: [{ uri: "ui://charts/chart.html", mimeType: "text/html;profile=mcp-app", text: "<html/>" }],
      })
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
  StreamableHTTPClientTransport: class {
    async start() {
      throw new Error("mock")
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    async start() {
      throw new Error("mock")
    }
  },
}))

process.env.OPENCODE_EXPERIMENTAL_MCP_APPS = "true"

const { MCP } = await import("../../src/mcp/index")

describe("structuredContent passthrough", () => {
  test("tool execute wraps structuredContent into metadata", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MCP.add("charts", { type: "local", command: ["echo"] }).catch(() => {})
        const tools = await MCP.tools()
        const tool = tools["charts_show_chart"]
        expect(tool).toBeDefined()
        expect(tool.execute).toBeDefined()

        const result = (await tool.execute!(
          {},
          { toolCallId: "call1", messages: [], abortSignal: new AbortController().signal },
        )) as Record<string, unknown>

        expect(result).toBeDefined()
        expect(result.structuredContent).toEqual(structuredPayload)
      },
    })
  })

  test("toolMeta carries resourceUri for app tools", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MCP.add("charts", { type: "local", command: ["echo"] }).catch(() => {})
        await MCP.tools()
        const meta = MCP.toolMeta("charts_show_chart")
        expect(meta?.resourceUri).toBe("ui://charts/chart.html")
      },
    })
  })
})
