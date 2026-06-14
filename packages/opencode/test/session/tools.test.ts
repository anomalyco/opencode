import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionTools } from "@/session/tools"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import type { TaskPromptOps } from "@/tool/task"
import * as Log from "@opencode-ai/core/util/log"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const providerID = ProviderID.make("test")
const modelID = ModelID.make("test-model")

const model: Provider.Model = {
  id: modelID,
  providerID,
  api: {
    id: "test-model",
    url: "https://example.invalid/v1",
    npm: "@ai-sdk/openai-compatible",
  },
  name: "Test Model",
  capabilities: {
    temperature: false,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 100000, output: 10000 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2025-01-01",
}

const agent = {
  name: "build",
  mode: "primary",
  options: {},
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
} as const

const sessionID = SessionID.make("ses_tools_test")
const messageID = MessageID.make("msg_tools_test")

const assistant: MessageV2.Assistant = {
  id: messageID,
  role: "assistant",
  sessionID,
  mode: "build",
  agent: "build",
  path: { cwd: "/tmp", root: "/tmp" },
  cost: 0,
  tokens: {
    total: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
  modelID,
  providerID,
  parentID: MessageID.make("msg_tools_parent"),
  time: { created: Date.now() },
}

const lookupParameters = Schema.Struct({ query: Schema.String })

const lookupTool: Tool.Def<typeof lookupParameters> = {
  id: "lookup",
  description: "Look up information",
  parameters: lookupParameters,
  jsonSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  execute: (args) =>
    Effect.succeed({
      title: "Lookup",
      output: `result:${args.query}`,
      metadata: { source: "unit" },
    }),
}

const pluginLayer = Layer.succeed(
  Plugin.Service,
  Plugin.Service.of({
    init: () => Effect.void,
    trigger: ((_name: unknown, _input: unknown, output: unknown) =>
      Effect.succeed(output)) as Plugin.Interface["trigger"],
    list: () => Effect.succeed([]),
    listHookControls: () => Effect.succeed([]),
    setHookControl: () => Effect.succeed([]),
  }),
)

const permissionLayer = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    ask: () => Effect.void,
    reply: () => Effect.void,
    list: () => Effect.succeed([]),
  }),
)

const registryLayer = Layer.succeed(
  ToolRegistry.Service,
  ToolRegistry.Service.of({
    ids: () => Effect.succeed(["lookup"]),
    all: () => Effect.succeed([lookupTool]),
    named: () => Effect.die("unused"),
    tools: () => Effect.succeed([lookupTool]),
  }),
)

const mcpLayer = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: {} }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unused"),
    authenticate: () => Effect.die("unused"),
    finishAuth: () => Effect.die("unused"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated"),
  }),
)

const truncateLayer = Layer.succeed(
  Truncate.Service,
  Truncate.Service.of({
    cleanup: () => Effect.void,
    write: (text) => Effect.succeed(text),
    output: (text) => Effect.succeed({ content: text, truncated: false as const }),
    limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50 * 1024 }),
  }),
)

const it = testEffect(Layer.mergeAll(pluginLayer, permissionLayer, registryLayer, mcpLayer, truncateLayer))

type ExecutableTool<Input, Output> = {
  execute: (input: Input, options: { toolCallId: string; abortSignal?: AbortSignal }) => Promise<Output>
}

it.instance("session tools settle processor tool calls after successful local execution", () =>
  Effect.gen(function* () {
    const completed: Array<{ toolCallID: string; output: unknown }> = []
    const promptOps = {
      cancel: () => Effect.void,
      resolvePromptParts: () => Effect.succeed([]),
      prompt: () => Effect.die("unused"),
      loop: () => Effect.die("unused"),
    } satisfies TaskPromptOps
    const session = {
      id: sessionID,
      permission: [],
    } as Session.Info

    const tools = yield* SessionTools.resolve({
      agent,
      model,
      session,
      processor: {
        message: assistant,
        updateToolCall: () => Effect.succeed(undefined),
        completeToolCall: (toolCallID, output) =>
          Effect.sync(() => {
            completed.push({ toolCallID, output })
          }),
      },
      bypassAgentCheck: false,
      messages: [],
      promptOps,
    })

    const lookup = tools.lookup as unknown as ExecutableTool<
      { query: string },
      { title: string; output: string; metadata: Record<string, unknown> }
    >
    const result = yield* Effect.promise(() =>
      lookup.execute({ query: "weather" }, { toolCallId: "call_1", abortSignal: new AbortController().signal }),
    )

    expect(result).toMatchObject({
      title: "Lookup",
      output: "result:weather",
      metadata: { source: "unit" },
    })
    expect(completed).toHaveLength(1)
    expect(completed[0]?.toolCallID).toBe("call_1")
    expect(completed[0]?.output).toMatchObject({
      title: "Lookup",
      output: "result:weather",
      metadata: { source: "unit" },
    })
  }),
)
