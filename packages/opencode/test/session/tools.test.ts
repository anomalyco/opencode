import { expect } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionProcessor } from "@/session/processor"
import { SessionTools } from "@/session/tools"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Plugin } from "@/plugin"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"

const callID = "call-test"
const sessionID = SessionID.make("ses_test")
const messageID = MessageID.ascending()
const partID = PartID.ascending()

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

function fakeMcp() {
  return MCP.Service.of({
    tools: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
  } as Partial<MCP.Interface> as MCP.Interface)
}

const fakePlugin = Plugin.Service.of({
  init: () => Effect.void,
  list: () => Effect.succeed([]),
  trigger: (_name, _input, output) => Effect.succeed(output),
} satisfies Plugin.Interface)

const fakePermission = Permission.Service.of({
  ask: () => Effect.void,
  reply: () => Effect.void,
  list: () => Effect.succeed([]),
} satisfies Permission.Interface)

const fakeTruncate = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed("output.txt"),
  output: (text: string) => Effect.succeed({ content: text, truncated: false }),
  limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50 * 1024 }),
} satisfies Truncate.Interface)

const layer = Layer.mergeAll(
  Layer.succeed(Plugin.Service, fakePlugin),
  Layer.succeed(Permission.Service, fakePermission),
  Layer.succeed(MCP.Service, fakeMcp()),
  Layer.succeed(Truncate.Service, fakeTruncate),
  RuntimeFlags.layer(),
  TestConfig.layer(),
  Layer.succeed(
    ToolRegistry.Service,
    ToolRegistry.Service.of({
      ids: () => Effect.succeed(["timing"]),
      all: () => Effect.succeed([]),
      named: () => Effect.die("unused"),
      tools: () =>
        Effect.succeed([
          {
            id: "timing",
            description: "updates metadata more than once",
            parameters: Schema.Struct({}),
            jsonSchema: { type: "object", properties: {} },
            execute: (_args, ctx) =>
              Effect.gen(function* () {
                yield* ctx.metadata({ metadata: { output: "first" } })
                yield* ctx.metadata({ metadata: { output: "second" } })
                return { title: "timing", metadata: {}, output: "done" }
              }),
          } satisfies Tool.Def,
        ]),
    }),
  ),
)

const it = testEffect(layer)

it.effect("preserves running tool start time across metadata updates", () =>
  Effect.gen(function* () {
    const state: SessionV1.ToolPart = {
      id: partID,
      sessionID,
      messageID,
      type: "tool",
      tool: "timing",
      callID,
      state: {
        status: "running",
        input: {},
        time: { start: 100 },
      },
    }
    const updates: number[] = []
    const processor = {
      message: {
        id: messageID,
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
      } satisfies SessionV1.Assistant,
      updateToolCall: (_toolCallID, update) =>
        Effect.sync(() => {
          const next = update(state)
          state.state = next.state
          if (state.state.status === "running") updates.push(state.state.time.start)
          return state
        }),
      completeToolCall: () => Effect.void,
    } satisfies Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">

    const tools = yield* SessionTools.resolve({
      agent,
      model,
      session: { id: sessionID, permission: [] } as unknown as Session.Info,
      processor,
      bypassAgentCheck: false,
      messages: [],
      promptOps: {} as never,
    })
    const execute = tools.timing.execute
    if (!execute) throw new Error("timing tool is missing execute")

    yield* Effect.promise(() =>
      execute(
        {},
        {
          toolCallId: callID,
          abortSignal: new AbortController().signal,
          messages: [],
        },
      ),
    )

    expect(updates).toEqual([100, 100])
    expect(state.state.status).toBe("running")
    if (state.state.status === "running") {
      expect(state.state.time.start).toBe(100)
    }
  }),
)

function limitLayer(input: {
  config?: Partial<ConfigV1.Info>
  tools?: Tool.Def[]
  mcp?: Record<string, MCP.McpTool>
  ask?: Permission.Interface["ask"]
}) {
  return Layer.mergeAll(
    Layer.succeed(Plugin.Service, fakePlugin),
    Layer.succeed(
      Permission.Service,
      Permission.Service.of({ ...fakePermission, ask: input.ask ?? fakePermission.ask }),
    ),
    Layer.succeed(
      MCP.Service,
      MCP.Service.of({
        tools: () => Effect.succeed(input.mcp ?? {}),
        clients: () => Effect.succeed({}),
      } as Partial<MCP.Interface> as MCP.Interface),
    ),
    Layer.succeed(Truncate.Service, fakeTruncate),
    RuntimeFlags.layer(),
    TestConfig.layer({ get: () => Effect.succeed(input.config ?? {}) }),
    Layer.succeed(
      ToolRegistry.Service,
      ToolRegistry.Service.of({
        ids: () => Effect.succeed((input.tools ?? []).map((tool) => tool.id)),
        all: () => Effect.succeed([]),
        named: () => Effect.die("unused"),
        tools: () => Effect.succeed(input.tools ?? []),
      }),
    ),
  )
}

const limitProcessor = {
  message: {
    id: messageID,
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
  } satisfies SessionV1.Assistant,
  updateToolCall: () => Effect.die("unused"),
  completeToolCall: () => Effect.void,
} satisfies Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">

const callTool = Effect.fn("test.callTool")(function* (name: string, args: Record<string, unknown> = {}) {
  const tools = yield* SessionTools.resolve({
    agent,
    model,
    session: { id: sessionID, permission: [] } as unknown as Session.Info,
    processor: limitProcessor,
    bypassAgentCheck: false,
    messages: [],
    promptOps: {} as never,
  })
  const execute = tools[name]?.execute
  if (!execute) throw new Error(`${name} tool is missing execute`)
  return yield* Effect.promise(() =>
    Promise.resolve(
      execute(args, { toolCallId: callID, abortSignal: new AbortController().signal, messages: [] }),
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
    ),
  )
})

// A server whose tool never answers until the request is cancelled, the way a wedged worker behaves.
function hangingMcp(toolTimeout?: number | false) {
  const seen = { signal: undefined as AbortSignal | undefined }
  const tool: MCP.McpTool = {
    def: { name: "wait", description: "never answers", inputSchema: { type: "object", properties: {} } },
    client: {
      callTool: (_params: unknown, _schema: unknown, options: { signal?: AbortSignal }) => {
        seen.signal = options.signal
        return new Promise((_resolve, reject) =>
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason)),
        )
      },
    } as unknown as MCP.McpTool["client"],
    server: "slow",
    toolTimeout,
  }
  return { seen, mcp: { slow_wait: tool } }
}

const mcpDeclared = hangingMcp(150)
testEffect(limitLayer({ mcp: mcpDeclared.mcp })).live("ends an MCP tool call at its server's tool_timeout", () =>
  Effect.gen(function* () {
    const result = yield* callTool("slow_wait")
    expect(result).toEqual({ ok: false, error: "tool call exceeded its 150ms limit (config: mcp.slow.tool_timeout)" })
    expect(mcpDeclared.seen.signal?.aborted).toBe(true)
  }),
)

const mcpOverridden = hangingMcp(false)
testEffect(limitLayer({ mcp: mcpOverridden.mcp, config: { tool_timeout: { slow_wait: 100 } } })).live(
  "a user's tool_timeout entry beats an MCP server's tool_timeout",
  () =>
    Effect.gen(function* () {
      const result = yield* callTool("slow_wait")
      expect(result).toEqual({
        ok: false,
        error: "tool call exceeded its 100ms limit (config: tool_timeout.slow_wait)",
      })
    }),
)

const hangingPlugin: Tool.Def = {
  id: "hang",
  description: "never finishes",
  parameters: Schema.Struct({}),
  jsonSchema: { type: "object", properties: {} },
  timeout: 100,
  execute: () => Effect.never,
}
testEffect(limitLayer({ tools: [hangingPlugin], config: { tool_timeout: { default: 60_000 } } })).live(
  "ends a hanging tool at its declared limit, not the global one",
  () =>
    Effect.gen(function* () {
      const result = yield* callTool("hang")
      expect(result).toEqual({ ok: false, error: "tool call exceeded its 100ms limit (tool default)" })
    }),
)

const asking: Tool.Def = {
  id: "asking",
  description: "waits on a permission prompt",
  parameters: Schema.Struct({}),
  jsonSchema: { type: "object", properties: {} },
  timeout: 100,
  execute: (_args, ctx) =>
    Effect.gen(function* () {
      yield* ctx.ask({ permission: "asking", patterns: ["*"], always: ["*"], metadata: {} })
      return { title: "", metadata: {}, output: "approved" }
    }),
}
testEffect(limitLayer({ tools: [asking], ask: () => Effect.promise(() => Bun.sleep(300)) })).live(
  "time waiting on a permission prompt does not count toward the limit",
  () =>
    Effect.gen(function* () {
      const result = yield* callTool("asking")
      expect(result.ok).toBe(true)
    }),
)
