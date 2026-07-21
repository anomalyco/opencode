import { describe, expect, test } from "bun:test"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Effect, Layer } from "effect"
import { SessionTools } from "@/session/tools"
import { MCP } from "@/mcp"
import { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MessageID, SessionID } from "@/session/schema"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Agent } from "@/agent/agent"
import type { Provider } from "@/provider/provider"
import type { Session } from "@/session/session"

function mcpTool(name: string): MCP.McpTool {
  return {
    def: { name, description: name, inputSchema: { type: "object", properties: {} } } as MCPToolDef,
    client: { callTool: async () => ({ content: [] }) } as unknown as MCP.McpTool["client"],
  }
}

function resolveTools(input: { mcpTools: Record<string, MCP.McpTool>; permission: PermissionV1.Rule[] }) {
  const harness = Layer.mergeAll(
    Layer.mock(Plugin.Service, {
      trigger: ((_name, _input, output) => Effect.succeed(output)) as Plugin.Interface["trigger"],
    }),
    Layer.mock(Permission.Service, {}),
    Layer.mock(ToolRegistry.Service, {
      tools: () => Effect.succeed([]),
    }),
    Layer.mock(Truncate.Service, {
      output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
    }),
    Layer.mock(MCP.Service, {
      tools: () => Effect.succeed(input.mcpTools),
      clients: () => Effect.succeed({}),
    }),
    RuntimeFlags.layer(),
  )
  return Effect.runPromise(
    SessionTools.resolve({
      agent: { name: "build", permission: input.permission } as unknown as Agent.Info,
      model: {
        api: { id: "test-model", npm: "@ai-sdk/anthropic" },
        providerID: "anthropic",
      } as unknown as Provider.Model,
      session: { id: SessionID.make("ses_tools_test"), permission: [] } as unknown as Session.Info,
      processor: {
        message: { id: MessageID.make("msg_tools_test") },
        updateToolCall: () => Effect.void,
        completeToolCall: () => Effect.void,
      } as any,
      bypassAgentCheck: false,
      messages: [],
      promptOps: {} as any,
    }).pipe(Effect.provide(harness)),
  )
}

describe("SessionTools.resolve MCP tool visibility", () => {
  // `tools: { "postman*": false }` compiles to a wholly-deny permission rule
  // `{ permission: "postman*", pattern: "*", action: "deny" }` (Permission.fromConfig).
  // Such tools must not be advertised to the provider, matching code-mode (#37675).
  test("excludes MCP tools denied by a wildcard permission rule", async () => {
    const tools = await resolveTools({
      mcpTools: { postman_search: mcpTool("search"), github_list: mcpTool("list") },
      permission: [{ permission: "postman*", pattern: "*", action: "deny" }],
    })
    expect(Object.keys(tools)).toContain("github_list")
    expect(Object.keys(tools)).not.toContain("postman_search")
  })

  test("keeps MCP tools when no denying rule matches", async () => {
    const tools = await resolveTools({
      mcpTools: { postman_search: mcpTool("search") },
      permission: [],
    })
    expect(Object.keys(tools)).toContain("postman_search")
  })

  // A resource-scoped deny (pattern !== "*") only gates specific calls at ask time;
  // it must not hide the tool, since it can still be allowed for other resources.
  test("keeps MCP tools whose only matching deny rule is resource-scoped", async () => {
    const tools = await resolveTools({
      mcpTools: { postman_search: mcpTool("search") },
      permission: [{ permission: "postman_search", pattern: "some/path", action: "deny" }],
    })
    expect(Object.keys(tools)).toContain("postman_search")
  })

  test("excludes only the denied tool, keeping siblings under the same server prefix", async () => {
    const tools = await resolveTools({
      mcpTools: { postman_search: mcpTool("search"), postman_other: mcpTool("other") },
      permission: [{ permission: "postman_search", pattern: "*", action: "deny" }],
    })
    expect(Object.keys(tools)).toContain("postman_other")
    expect(Object.keys(tools)).not.toContain("postman_search")
  })
})
