import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { jsonSchema, type Tool as AITool, type ToolExecutionOptions } from "ai"
import type { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Session } from "@/session/session"
import type { SessionProcessor } from "@/session/processor"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { TaskPromptOps } from "@/tool/task"
import { SessionTools } from "@/session/tools"
import { McpLazyActivation } from "@/session/mcp-lazy"
import { MessageID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

// Item 28: MCP tools lazy via the tool_search meta-tool. The MCP service is a
// stub with two fake tools; everything else resolve() touches is stubbed to a
// no-op so the test pins EXACTLY the registration behavior:
//  (1) lazy ⇒ no MCP keys, only tool_search
//  (2) tool_search activates matched keys and returns name+schema
//  (3) the next resolve of the SAME session registers the activated tool fully
//  (4) default/eager ⇒ identical to today (all MCP keys, no tool_search)
//  (5) no MCP servers ⇒ no tool_search either
const it = testEffect(Layer.mergeAll(McpLazyActivation.defaultLayer))

// Fresh tool objects per call — the eager registration mutates item.inputSchema
// and item.execute in place, exactly like the real MCP.tools() result (built
// fresh per call).
function fakeMcpTools(): Record<string, AITool> {
  return {
    "weather_get-forecast": {
      description: "Get the weather forecast for a city",
      inputSchema: jsonSchema({ type: "object", properties: { city: { type: "string" } }, required: ["city"] }),
      execute: async () => ({ content: [{ type: "text", text: "sunny" }] }),
    } as unknown as AITool,
    "tickets_create-issue": {
      description: "Create an issue in the ticket tracker",
      inputSchema: jsonSchema({ type: "object", properties: { title: { type: "string" } } }),
      execute: async () => ({ content: [{ type: "text", text: "created" }] }),
    } as unknown as AITool,
  }
}

const mcpStub = (tools: () => Record<string, AITool>) =>
  MCP.Service.of({
    tools: () => Effect.sync(tools),
  } as unknown as MCP.Interface)

const pluginStub = Plugin.Service.of({
  trigger: (() => Effect.succeed({})) as unknown as Plugin.Interface["trigger"],
} as unknown as Plugin.Interface)

const permissionStub = Permission.Service.of({
  ask: () => Effect.void,
  reply: () => Effect.void,
  list: () => Effect.succeed([]),
} as unknown as Permission.Interface)

// No builtin tools — the MCP registration behavior is the test subject.
const registryStub = ToolRegistry.Service.of({
  tools: () => Effect.succeed([]),
} as unknown as ToolRegistry.Interface)

const truncateStub = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed("/tmp/unused"),
  output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
  limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 51200 }),
} as unknown as Truncate.Interface)

// resolve() walks the session lineage only for ROUTED permission asks; these
// tests never route, so the stub dying on access doubles as a guard.
const sessionStub = Session.Service.of({
  lineage: () => Effect.die(new Error("lineage must not be walked in the lazy-MCP tests")),
} as unknown as Session.Interface)

const fakeModel = { providerID: "test", api: { id: "test-model" } } as Provider.Model

function resolveInput(sessionID: SessionID, mcpMode?: "eager" | "lazy") {
  return {
    agent: { name: "build", mode: "primary", permission: [], options: {} } as Agent.Info,
    model: fakeModel,
    session: { id: sessionID } as Session.Info,
    processor: {
      message: { id: MessageID.make("msg_lazy_test") } as SessionV1.Assistant,
      updateToolCall: () => Effect.succeed(undefined),
      completeToolCall: () => Effect.void,
    } as unknown as Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">,
    bypassAgentCheck: false,
    messages: [] as SessionV1.WithParts[],
    promptOps: {} as TaskPromptOps,
    mcpMode,
  }
}

const provideStubs =
  (tools: () => Record<string, AITool>) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.provideService(Plugin.Service, pluginStub),
      Effect.provideService(Permission.Service, permissionStub),
      Effect.provideService(ToolRegistry.Service, registryStub),
      Effect.provideService(MCP.Service, mcpStub(tools)),
      Effect.provideService(Truncate.Service, truncateStub),
      Effect.provideService(Session.Service, sessionStub),
    )

const callOptions = { toolCallId: "call_lazy_test", messages: [] } as unknown as ToolExecutionOptions

describe("session.tools lazy MCP", () => {
  it.instance("lazy mode registers tool_search and ZERO MCP keys/schemas", () =>
    Effect.gen(function* () {
      const sessionID = SessionID.make("ses_lazy_one")
      const tools = yield* SessionTools.resolve(resolveInput(sessionID, "lazy")).pipe(provideStubs(fakeMcpTools))
      const keys = Object.keys(tools)
      expect(keys).toContain("tool_search")
      expect(keys).not.toContain("weather_get-forecast")
      expect(keys).not.toContain("tickets_create-issue")
      // Only the meta-tool — no MCP schema was transformed/registered.
      expect(keys).toHaveLength(1)
    }),
  )

  it.instance("tool_search activates matched keys and returns name + input_schema", () =>
    Effect.gen(function* () {
      const sessionID = SessionID.make("ses_lazy_two")
      const activation = yield* McpLazyActivation.Service
      const tools = yield* SessionTools.resolve(resolveInput(sessionID, "lazy")).pipe(provideStubs(fakeMcpTools))
      const search = tools["tool_search"]
      expect(search).toBeDefined()
      const result = (yield* Effect.promise(() =>
        Promise.resolve(search.execute!({ query: "weather forecast" }, callOptions)),
      )) as { output: string; metadata: { matches: string[] } }
      // The weather tool matched (and ONLY it — 'forecast'/'weather' miss the
      // ticket tool), was activated, and its schema is in the output.
      expect(result.metadata.matches).toEqual(["weather_get-forecast"])
      expect(result.output).toContain("weather_get-forecast")
      expect(result.output).toContain("city")
      expect(result.output).toContain("These tools are registered and callable from your next step.")
      const activated = yield* activation.get(sessionID)
      expect([...activated]).toEqual(["weather_get-forecast"])
    }),
  )

  it.instance("the next resolve of the same session registers the activated tool fully", () =>
    Effect.gen(function* () {
      const sessionID = SessionID.make("ses_lazy_three")
      // Step 1: search + activate.
      const first = yield* SessionTools.resolve(resolveInput(sessionID, "lazy")).pipe(provideStubs(fakeMcpTools))
      yield* Effect.promise(() => Promise.resolve(first["tool_search"].execute!({ query: "weather" }, callOptions)))
      // Step 2 (the prompt loop re-resolves per step): the activated tool is
      // now FULLY registered (callable), the other stays lazy.
      const second = yield* SessionTools.resolve(resolveInput(sessionID, "lazy")).pipe(provideStubs(fakeMcpTools))
      expect(Object.keys(second)).toContain("weather_get-forecast")
      expect(Object.keys(second)).toContain("tool_search")
      expect(Object.keys(second)).not.toContain("tickets_create-issue")
      // Really callable: the wrapped execute round-trips the MCP content.
      const output = (yield* Effect.promise(() =>
        Promise.resolve(second["weather_get-forecast"].execute!({ city: "Leer" }, callOptions)),
      )) as { output: string }
      expect(output.output).toContain("sunny")
    }),
  )

  it.instance("default (eager) mode registers every MCP tool and no tool_search", () =>
    Effect.gen(function* () {
      const sessionID = SessionID.make("ses_lazy_four")
      const tools = yield* SessionTools.resolve(resolveInput(sessionID)).pipe(provideStubs(fakeMcpTools))
      const keys = Object.keys(tools)
      expect(keys).toContain("weather_get-forecast")
      expect(keys).toContain("tickets_create-issue")
      expect(keys).not.toContain("tool_search")
    }),
  )

  it.instance("lazy mode with no MCP tools registers neither MCP keys nor tool_search", () =>
    Effect.gen(function* () {
      const sessionID = SessionID.make("ses_lazy_five")
      const tools = yield* SessionTools.resolve(resolveInput(sessionID, "lazy")).pipe(provideStubs(() => ({})))
      expect(Object.keys(tools)).toHaveLength(0)
    }),
  )

  it.instance("tool_search with no match names the available tools instead of activating", () =>
    Effect.gen(function* () {
      const sessionID = SessionID.make("ses_lazy_six")
      const activation = yield* McpLazyActivation.Service
      const tools = yield* SessionTools.resolve(resolveInput(sessionID, "lazy")).pipe(provideStubs(fakeMcpTools))
      const result = (yield* Effect.promise(() =>
        Promise.resolve(tools["tool_search"].execute!({ query: "zzz-nothing-matches" }, callOptions)),
      )) as { output: string; metadata: { matches: string[] } }
      expect(result.metadata.matches).toEqual([])
      expect(result.output).toContain("No MCP tools matched")
      expect(result.output).toContain("weather_get-forecast")
      expect((yield* activation.get(sessionID)).size).toBe(0)
    }),
  )
})
