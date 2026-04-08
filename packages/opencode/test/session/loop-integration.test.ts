import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { FileTime } from "../../src/file/time"
import { AppFileSystem } from "../../src/filesystem"
import { LSP } from "../../src/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { Instruction } from "../../src/session/instruction"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { Todo } from "../../src/session/todo"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { Log } from "../../src/util/log"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

Log.init({ print: false })

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const filetime = Layer.succeed(
  FileTime.Service,
  FileTime.Service.of({
    read: () => Effect.void,
    get: () => Effect.succeed(undefined),
    assert: () => Effect.void,
    withLock: (_filepath, fn) => Effect.promise(fn),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeHttp() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    filetime,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    status,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(Layer.provideMerge(deps))
  const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provideMerge(compact),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provide(Instruction.defaultLayer),
      Layer.provideMerge(deps),
    ),
  )
}

const it = testEffect(makeHttp())

// Build a repeating text payload that triggers loop detection with the given
// config thresholds. The segment is repeated twice so the detector sees two
// adjacent identical blocks.
function looping(period: number) {
  const segment = "abcdefghij".repeat(Math.ceil(period / 10)).slice(0, period)
  return segment + segment
}

// Config that registers a custom "test" provider and sets very low loop
// detection thresholds so the detector fires quickly.
function config(url: string) {
  return {
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: url,
        },
      },
    },
    experimental: {
      loop: {
        enabled: true,
        min_period: 10,
        max_period: 200,
        similarity: 1.0,
        check_interval: 1,
        min_chars: 20,
        max_nudges: 1,
      },
    },
  }
}

const PERIOD = 50

describe("loop-integration", () => {
  it.live(
    "detect -> nudge -> detect -> abort across the prompt pipeline",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service

          const session = yield* sessions.create({
            title: "Loop test",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          // Queue the user message
          yield* prompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          })

          // First model response: repeating text → triggers loop detection → nudge
          yield* llm.push(reply().text(looping(PERIOD)).stop())
          // Second model response (after nudge): repeating text again → triggers loop detection → abort
          yield* llm.push(reply().text(looping(PERIOD)).stop())

          const result = yield* prompt.loop({ sessionID: session.id })

          // --- Assertion 1: final assistant message has LoopError ---
          expect(result.info.role).toBe("assistant")
          if (result.info.role !== "assistant") return
          expect(result.info.error).toBeDefined()
          expect(result.info.error?.name).toBe("LoopError")

          // --- Assertion 4: LoopError.data.source === "text" ---
          const data = result.info.error?.data as { source?: string; attempts?: number } | undefined
          expect(data?.source).toBe("text")

          // --- Assertion 5: LoopError.data.attempts === 2 ---
          expect(data?.attempts).toBe(2)

          // --- Assertions 2 & 6: exactly one synthetic reminder exists ---
          const msgs = yield* MessageV2.filterCompactedEffect(session.id)
          const reminders = msgs.filter(
            (m) =>
              m.info.role === "user" &&
              m.parts.some((p) => p.type === "text" && p.synthetic && p.text.includes("repeating")),
          )
          expect(reminders).toHaveLength(1)

          // --- Assertion 3: second model request contains the persisted <system-reminder> ---
          // The test LLM server captures all request bodies. The title request is
          // auto-handled, so we filter to non-title hits. The second non-title
          // request should contain the reminder text in its messages.
          const inputs = yield* llm.inputs
          // Filter out title-generation requests
          const model = inputs.filter((body) => !JSON.stringify(body).includes("Generate a title"))
          expect(model.length).toBeGreaterThanOrEqual(2)
          const second = JSON.stringify(model[1])
          expect(second).toContain("repeating")
        }),
        { git: true, config },
      ),
    15_000,
  )
})
