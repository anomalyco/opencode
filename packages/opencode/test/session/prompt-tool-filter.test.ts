import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { jsonSchema } from "ai"
import { Config } from "../../src/config/config"
import { MCP } from "../../src/mcp"
import { SessionPrompt } from "../../src/session/prompt"
import { ToolRegistry } from "../../src/tool/registry"

type ResolveToolsInput = Parameters<typeof SessionPrompt.resolveTools>[0]
type McpToolsMap = Awaited<ReturnType<typeof MCP.tools>>
type ConfigInfo = Awaited<ReturnType<typeof Config.get>>

const baseInput = (): ResolveToolsInput =>
  ({
    agent: {
      name: "test-agent",
      permission: [],
    },
    model: {
      providerID: "openai",
      api: {
        id: "gpt-5.1",
      },
    },
    session: {
      id: "session_test",
      permission: [],
    },
    processor: {
      message: { id: "message_test" },
      partFromToolCall: () => undefined,
    },
    bypassAgentCheck: false,
    messages: [],
  }) as unknown as ResolveToolsInput

const createMcpTool = () =>
  ({
    description: "mock tool",
    inputSchema: jsonSchema({ type: "object", properties: {} }),
    execute: async () => ({
      content: [],
    }),
  }) as McpToolsMap[string]

const createConfig = (mcp: ConfigInfo["mcp"]): ConfigInfo => ({
  mcp,
}) as ConfigInfo

describe("session.prompt MCP tool filtering", () => {
  let toolsSpy: ReturnType<typeof spyOn>
  let configSpy: ReturnType<typeof spyOn>
  let registrySpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    toolsSpy = spyOn(MCP, "tools").mockResolvedValue({})
    configSpy = spyOn(Config, "get").mockResolvedValue(createConfig({}))
    registrySpy = spyOn(ToolRegistry, "tools").mockResolvedValue([])
  })

  afterEach(() => {
    toolsSpy.mockRestore()
    configSpy.mockRestore()
    registrySpy.mockRestore()
  })

  test("includeTools limits tool set for one server", async () => {
    toolsSpy.mockResolvedValue({
      "miro-community_miro_list_boards": createMcpTool(),
      "miro-community_miro_create_board": createMcpTool(),
    })
    configSpy.mockResolvedValue(
      createConfig({
        "miro-community": {
          type: "remote",
          url: "https://example.com/mcp",
          includeTools: ["miro_list_boards"],
        },
      }),
    )

    const resolved = await SessionPrompt.resolveTools(baseInput())

    expect(Object.keys(resolved)).toEqual(["miro-community_miro_list_boards"])
  })

  test("excludeTools removes specific tools and keeps others", async () => {
    toolsSpy.mockResolvedValue({
      "miro-community_miro_list_boards": createMcpTool(),
      "miro-community_miro_create_board": createMcpTool(),
    })
    configSpy.mockResolvedValue(
      createConfig({
        "miro-community": {
          type: "remote",
          url: "https://example.com/mcp",
          excludeTools: ["miro_create_board"],
        },
      }),
    )

    const resolved = await SessionPrompt.resolveTools(baseInput())

    expect(Object.keys(resolved)).toEqual(["miro-community_miro_list_boards"])
  })

  test("excludeTools takes precedence over includeTools", async () => {
    toolsSpy.mockResolvedValue({
      "miro-community_miro_list_boards": createMcpTool(),
      "miro-community_miro_create_board": createMcpTool(),
    })
    configSpy.mockResolvedValue(
      createConfig({
        "miro-community": {
          type: "remote",
          url: "https://example.com/mcp",
          includeTools: ["miro_list_boards", "miro_create_board"],
          excludeTools: ["miro_list_boards"],
        },
      }),
    )

    const resolved = await SessionPrompt.resolveTools(baseInput())

    expect(Object.keys(resolved)).toEqual(["miro-community_miro_create_board"])
  })

  test("filters apply only to configured server", async () => {
    toolsSpy.mockResolvedValue({
      "miro-community_miro_list_boards": createMcpTool(),
      "miro-community_miro_create_board": createMcpTool(),
      weather_server_get_forecast: createMcpTool(),
    })
    configSpy.mockResolvedValue(
      createConfig({
        "miro-community": {
          type: "remote",
          url: "https://example.com/mcp",
          includeTools: ["miro_list_boards"],
        },
      }),
    )

    const resolved = await SessionPrompt.resolveTools(baseInput())

    expect(Object.keys(resolved).sort()).toEqual([
      "miro-community_miro_list_boards",
      "weather_server_get_forecast",
    ])
  })

  test("without includeTools/excludeTools all MCP tools pass through", async () => {
    toolsSpy.mockResolvedValue({
      "miro-community_miro_list_boards": createMcpTool(),
      "miro-community_miro_create_board": createMcpTool(),
    })
    configSpy.mockResolvedValue(
      createConfig({
        "miro-community": {
          type: "remote",
          url: "https://example.com/mcp",
        },
      }),
    )

    const resolved = await SessionPrompt.resolveTools(baseInput())

    expect(Object.keys(resolved).sort()).toEqual([
      "miro-community_miro_create_board",
      "miro-community_miro_list_boards",
    ])
  })

  test("empty includeTools excludes all tools from that server", async () => {
    toolsSpy.mockResolvedValue({
      "miro-community_miro_list_boards": createMcpTool(),
      "miro-community_miro_create_board": createMcpTool(),
    })
    configSpy.mockResolvedValue(
      createConfig({
        "miro-community": {
          type: "remote",
          url: "https://example.com/mcp",
          includeTools: [],
        },
      }),
    )

    const resolved = await SessionPrompt.resolveTools(baseInput())

    expect(Object.keys(resolved)).toEqual([])
  })
})
