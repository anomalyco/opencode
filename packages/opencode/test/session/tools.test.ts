import { expect } from "bun:test"
import { Agent } from "@/agent/agent"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { SessionTools } from "@/session/tools"
import { MessageID, SessionID } from "@/session/schema"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import type { TaskPromptOps } from "@/tool/task"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { CallToolResultSchema, type CallToolRequest, type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { Effect, Layer } from "effect"
import { it } from "../lib/effect"

it.effect("forwards plugin metadata to normal MCP tool calls", () => {
  const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
  let request: CallToolRequest["params"] | undefined
  const def = {
    name: "tool",
    description: "Test tool",
    inputSchema: { type: "object", properties: {} },
  } as MCPToolDef
  const client = {
    getServerCapabilities: () => undefined,
    callTool: async (params: CallToolRequest["params"], schema: typeof CallToolResultSchema) => {
      request = params
      return schema.parse({ content: [{ type: "text", text: "ok" }] })
    },
  } as unknown as Client
  const trigger = ((name: unknown, _input: unknown, output: { _meta?: Record<string, unknown> }) =>
    Effect.sync(() => {
      if (name === "tool.execute.before") output._meta = { traceparent }
      return output
    })) as Plugin.Interface["trigger"]
  const layer = Layer.mergeAll(
    Layer.mock(Plugin.Service, { trigger }),
    Layer.mock(Permission.Service, { ask: () => Effect.void }),
    Layer.mock(ToolRegistry.Service, { tools: () => Effect.succeed([]) }),
    Layer.mock(MCP.Service, {
      tools: () => Effect.succeed({ server_tool: { def, client } }),
      clients: () => Effect.succeed({}),
    }),
    Layer.mock(Truncate.Service, {
      output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
    }),
    RuntimeFlags.layer({ experimentalCodeMode: false }),
  )

  return Effect.gen(function* () {
    const tools = yield* SessionTools.resolve({
      agent: { name: "build", permission: [] } as unknown as Agent.Info,
      model: { providerID: "test", api: { id: "test", npm: "test" } } as Provider.Model,
      session: { id: SessionID.make("ses_meta"), permission: [] } as unknown as Session.Info,
      processor: {
        message: { id: MessageID.make("msg_meta") } as unknown as SessionV1.Assistant,
        updateToolCall: () => Effect.succeed(undefined),
        completeToolCall: () => Effect.void,
      },
      bypassAgentCheck: false,
      messages: [],
      promptOps: {} as TaskPromptOps,
    })

    yield* Effect.promise(() =>
      tools.server_tool!.execute!(
        {},
        {
          toolCallId: "call_meta",
          abortSignal: new AbortController().signal,
          messages: [],
        },
      ),
    )

    expect(request?._meta).toMatchObject({ traceparent })
  }).pipe(Effect.provide(layer))
})
