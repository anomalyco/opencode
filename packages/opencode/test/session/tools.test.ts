import { expect } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
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

function resourceMcp() {
  const client = () =>
    ({ getServerCapabilities: () => ({ tools: {}, resources: {} }) }) as unknown as MCP.McpTool["client"]
  const jira = client()
  const docs = client()
  const def = (name: string) => ({ name, inputSchema: { type: "object" as const, properties: {} } })
  return MCP.Service.of({
    clients: () => Effect.succeed({ jira, docs }),
    tools: () =>
      Effect.succeed({
        jira_search: { def: def("search"), client: jira },
        docs_lookup: { def: def("lookup"), client: docs },
      }),
    resources: () =>
      Effect.succeed({
        "jira:board": { name: "board", uri: "jira://board", client: "jira" },
        "docs:index": { name: "index", uri: "docs://index", client: "docs" },
      }),
  } as Partial<MCP.Interface> as MCP.Interface)
}

const resolveWith = (permission: PermissionV1.Ruleset) =>
  SessionTools.resolve({
    agent: { ...agent, permission: [{ permission: "*", pattern: "*", action: "allow" }, ...permission] },
    model,
    session: { id: sessionID, permission: [] } as unknown as Session.Info,
    processor: {
      message: { id: messageID } as SessionV1.Assistant,
      updateToolCall: () => Effect.die("unused"),
      completeToolCall: () => Effect.void,
    },
    bypassAgentCheck: false,
    messages: [],
    promptOps: {} as never,
  }).pipe(Effect.provideService(MCP.Service, resourceMcp()))

const call = (item: { execute?: (args: never, options: never) => unknown }, args: unknown) =>
  Effect.promise(async () =>
    item.execute!(
      args as never,
      { toolCallId: callID, abortSignal: new AbortController().signal, messages: [] } as never,
    ),
  )

it.effect("hides resources of MCP servers whose tools the agent denies", () =>
  Effect.gen(function* () {
    const tools = yield* resolveWith(Permission.fromConfig({ "jira_*": "deny" }))
    const listed = (yield* call(tools.list_mcp_resources, {})) as { output: string; metadata: { servers: string[] } }
    expect(listed.metadata.servers).toEqual(["docs"])
    expect(listed.output).not.toContain("jira://board")
    expect(listed.output).toContain("docs://index")

    const read = yield* call(tools.read_mcp_resource, { server: "jira", uri: "jira://board" }).pipe(Effect.exit)
    expect(String(read)).toContain('MCP server "jira" is not available to this agent')
  }),
)

it.effect("omits MCP resource tools when the agent denies every resource server", () =>
  Effect.gen(function* () {
    const tools = yield* resolveWith(Permission.fromConfig({ "jira_*": "deny", "docs_*": "deny" }))
    expect(tools.list_mcp_resources).toBeUndefined()
    expect(tools.read_mcp_resource).toBeUndefined()
  }),
)

it.effect("keeps MCP resources for an agent that allows the server", () =>
  Effect.gen(function* () {
    const tools = yield* resolveWith(Permission.fromConfig({ "jira_*": "allow" }))
    const listed = (yield* call(tools.list_mcp_resources, {})) as { metadata: { servers: string[] } }
    expect(listed.metadata.servers).toEqual(["docs", "jira"])
  }),
)
