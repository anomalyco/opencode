import { describe, expect, test, mock, beforeEach } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// Mock MCP client to avoid actual connections
const mockTools = [
  { name: "tool_one", description: "First tool", inputSchema: { type: "object", properties: {} } },
  { name: "tool_two", description: "Second tool", inputSchema: { type: "object", properties: {} } },
  { name: "tool_three", description: "Third tool", inputSchema: { type: "object", properties: {} } },
]

let mockClientStatus = "connected"

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    async start() {
      if (mockClientStatus === "connected") return
      throw new Error("Mock transport cannot connect")
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    async start() {
      if (mockClientStatus === "connected") return
      throw new Error("Mock transport cannot connect")
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect() {}
    async listTools() {
      return { tools: mockTools }
    }
    async listPrompts() {
      return { prompts: [] }
    }
    async listResources() {
      return { resources: [] }
    }
    async callTool() {
      return { content: [] }
    }
  },
}))

beforeEach(() => {
  mockClientStatus = "connected"
})

// Import modules after mocking
const { Config } = await import("../../src/config/config")
const { Session } = await import("../../src/session")
const { ToolRegistry } = await import("../../src/tool/registry")
const { SystemPrompt } = await import("../../src/session/system")
const { MCP } = await import("../../src/mcp/index")

describe("MCP lazy loading", () => {
  describe("config", () => {
    test("mcp_lazy_load defaults to undefined (off)", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          expect(config.experimental?.mcp_lazy_load).toBeUndefined()
        },
      })
    })

    test("mcp_lazy_load can be enabled", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: {
                mcp_lazy_load: true,
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          expect(config.experimental?.mcp_lazy_load).toBe(true)
        },
      })
    })
  })

  describe("session.mcpLoadedTools", () => {
    test("session can store mcpLoadedTools", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          // Update session with loaded tools
          await Session.update(session.id, (draft) => {
            draft.mcpLoadedTools = {
              "test-server": ["tool_one", "tool_two"],
            }
          })

          const updated = await Session.get(session.id)
          expect(updated.mcpLoadedTools).toEqual({
            "test-server": ["tool_one", "tool_two"],
          })

          await Session.remove(session.id)
        },
      })
    })

    test("mcpLoadedTools can accumulate tools", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          // First update
          await Session.update(session.id, (draft) => {
            draft.mcpLoadedTools = {
              "server-a": ["tool1"],
            }
          })

          // Second update - add more tools
          const current = await Session.get(session.id)
          await Session.update(session.id, (draft) => {
            draft.mcpLoadedTools = {
              ...current.mcpLoadedTools,
              "server-a": [...(current.mcpLoadedTools?.["server-a"] ?? []), "tool2"],
              "server-b": ["toolX"],
            }
          })

          const updated = await Session.get(session.id)
          expect(updated.mcpLoadedTools).toEqual({
            "server-a": ["tool1", "tool2"],
            "server-b": ["toolX"],
          })

          await Session.remove(session.id)
        },
      })
    })
  })

  describe("tool registry", () => {
    test("mcp_load_tools is registered when lazy loading is enabled", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: {
                mcp_lazy_load: true,
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          expect(ids).toContain("mcp_load_tools")
        },
      })
    })

    test("mcp_load_tools is NOT registered when lazy loading is disabled", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: {
                mcp_lazy_load: false,
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          expect(ids).not.toContain("mcp_load_tools")
        },
      })
    })
  })

  describe("SystemPrompt.mcpIndex", () => {
    test("returns empty array when lazy loading is disabled", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: {
                mcp_lazy_load: false,
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await SystemPrompt.mcpIndex()
          expect(result).toEqual([])
        },
      })
    })

    test("returns empty array when no MCP servers configured", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: {
                mcp_lazy_load: true,
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await SystemPrompt.mcpIndex()
          expect(result).toEqual([])
        },
      })
    })
  })

  describe("MCP.loadToolsForSession", () => {
    test("returns error for non-existent server", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: {
                mcp_lazy_load: true,
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await MCP.loadToolsForSession("non-existent-server")
          expect(result.error).toBeDefined()
          expect(result.error).toContain("not found")
          expect(result.tools).toEqual([])
        },
      })
    })
  })

  describe("MCP.index", () => {
    test("returns empty object when no servers connected", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: {
                mcp_lazy_load: true,
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const index = await MCP.index()
          expect(index).toEqual({})
        },
      })
    })
  })

  describe("MCP.tools", () => {
    test("returns empty object when no servers connected", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              experimental: {
                mcp_lazy_load: true,
              },
            }),
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tools = await MCP.tools({})
          expect(tools).toEqual({})
        },
      })
    })
  })
})
