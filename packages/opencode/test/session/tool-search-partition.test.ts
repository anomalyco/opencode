import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { McpToolSearch } from "@/mcp/tool-search"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "@/session/schema"
import { SessionTools } from "@/session/tools"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Plugin } from "@/plugin"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Config } from "@/config/config"
import { testEffect } from "../lib/effect"
import { TestInstance, disposeAllInstances } from "../fixture/fixture"
import { TestConfig } from "../fixture/config"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { SessionProcessor } from "@/session/processor"

const sessionID = SessionID.make("ses_partition")

const agent: Agent.Info = {
  name: "build",
  mode: "primary",
  options: {},
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
}

const model = {
  providerID: ProviderV2.ID.make("test"),
  api: { id: "test-model" },
} as Provider.Model

function mcpTool(server: string, name: string, description: string): MCP.McpTool {
  return {
    def: { name, description, inputSchema: { type: "object", properties: {} } } as MCPToolDef,
    client: {
      callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
    } as unknown as MCP.McpTool["client"],
    server,
  }
}

const MCP_TOOLS: Record<string, MCP.McpTool> = {
  github_create_issue: mcpTool("github", "create_issue", "Create a GitHub issue"),
  github_list_repos: mcpTool("github", "list_repos", "List repositories"),
}

function fakeMcp() {
  const client = { getServerCapabilities: () => ({}) } as unknown as MCP.McpTool["client"]
  return Layer.mock(MCP.Service, {
    tools: () => Effect.succeed(MCP_TOOLS),
    clients: () => Effect.succeed({ github: client }),
  })
}

const fakePlugin = Layer.succeed(
  Plugin.Service,
  Plugin.Service.of({
    init: () => Effect.void,
    list: () => Effect.succeed([]),
    trigger: (_name, _input, output) => Effect.succeed(output),
  } satisfies Plugin.Interface),
)

const fakePermission = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    ask: () => Effect.void,
    reply: () => Effect.void,
    list: () => Effect.succeed([]),
  } satisfies Permission.Interface),
)

const fakeTruncate = Layer.succeed(
  Truncate.Service,
  Truncate.Service.of({
    cleanup: () => Effect.void,
    write: () => Effect.succeed("output.txt"),
    output: (text: string) => Effect.succeed({ content: text, truncated: false }),
    limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50 * 1024 }),
  } satisfies Truncate.Interface),
)

const fakeRegistry = Layer.succeed(
  ToolRegistry.Service,
  ToolRegistry.Service.of({
    ids: () => Effect.succeed([]),
    all: () => Effect.succeed([]),
    named: () => Effect.die("unused"),
    tools: () => Effect.succeed([]),
  }),
)

const processor = {
  message: {
    id: MessageID.ascending(),
    sessionID,
    role: "assistant",
    parentID: MessageID.ascending(),
    agent: "build",
    mode: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelV2.ID.make("test-model"),
    providerID: ProviderV2.ID.make("test"),
    time: { created: 1 },
  },
  updateToolCall: () => Effect.void,
  completeToolCall: () => Effect.void,
} as unknown as Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">

function harness(mcp_tool_search: ConfigV1.Info["mcp_tool_search"]) {
  const config = TestConfig.layer({ get: () => Effect.succeed({ mcp_tool_search }) })
  return testEffect(
    LayerNode.compile(LayerNode.group([McpToolSearch.node]), [
      [Config.node, config],
      [MCP.node, fakeMcp()],
    ]).pipe(
      Layer.merge(fakePlugin),
      Layer.merge(fakePermission),
      Layer.merge(fakeTruncate),
      Layer.merge(fakeRegistry),
      Layer.merge(RuntimeFlags.layer()),
      Layer.merge(config),
      Layer.merge(fakeMcp()),
    ),
  )
}

function resolve() {
  return SessionTools.resolve({
    agent,
    model,
    session: { id: sessionID, permission: [] } as unknown as Session.Info,
    processor,
    bypassAgentCheck: false,
    messages: [],
    promptOps: {} as never,
  })
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("session tool-search partitioning", () => {
  harness("always").instance("hides unresolved MCP tools and reveals them after search", () =>
    Effect.gen(function* () {
      yield* TestInstance
      // First turn: MCP tools are held back, none registered.
      const before = yield* resolve()
      expect(Object.keys(before)).not.toContain("github_create_issue")
      expect(Object.keys(before)).not.toContain("github_list_repos")

      // Simulate a search_tools call surfacing one of them.
      const svc = yield* McpToolSearch.Service
      const matches = yield* svc.search({ sessionID, query: "issue", ruleset: [] })
      expect(matches.map((m) => m.id)).toContain("github_create_issue")

      // Next turn: the surfaced tool is registered, the other stays hidden.
      const after = yield* resolve()
      expect(Object.keys(after)).toContain("github_create_issue")
      expect(Object.keys(after)).not.toContain("github_list_repos")
    }),
  )

  harness("off").instance("registers every MCP tool when tool search is off", () =>
    Effect.gen(function* () {
      yield* TestInstance
      const tools = yield* resolve()
      expect(Object.keys(tools)).toContain("github_create_issue")
      expect(Object.keys(tools)).toContain("github_list_repos")
    }),
  )
})
