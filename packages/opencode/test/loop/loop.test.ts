import { NodeFileSystem } from "@effect/platform-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { FetchHttpClient } from "effect/unstable/http"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent as AgentSvc } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "@/env"
import { Git } from "@/git"
import { Image } from "@/image/image"
import { Question } from "@/question"
import { Todo } from "@/session/todo"
import { Loop } from "@/loop/loop"
import { LLM } from "@/session/llm"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { SessionSummary } from "@/session/summary"
import { Instruction } from "@/session/instruction"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { Skill } from "@/skill"
import { SystemPrompt } from "@/session/system"
import { Snapshot } from "@/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Format } from "@/format"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Database } from "@opencode-ai/core/database/database"
import { TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

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
    startAuth: () => Effect.die("unexpected MCP auth in loop tests"),
    authenticate: () => Effect.die("unexpected MCP auth in loop tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in loop tests"),
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

const status = SessionStatus.layer.pipe(Layer.provideMerge(EventV2Bridge.defaultLayer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeLoop() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    FSUtil.defaultLayer,
    BackgroundJob.defaultLayer,
    status,
    Database.defaultLayer,
    EventV2Bridge.defaultLayer,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer.pipe(
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(proc),
    Layer.provideMerge(deps),
  )
  const promptLayer = SessionPrompt.layer.pipe(
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(summary),
    Layer.provideMerge(run),
    Layer.provideMerge(compact),
    Layer.provideMerge(proc),
    Layer.provideMerge(registry),
    Layer.provideMerge(trunc),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(SystemPrompt.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
    Layer.provide(summary),
  )
  // Loop.layer directly requires Session.Service and EventV2Bridge.Service
  // (not just SessionPrompt.Service, which promptLayer alone satisfies), and
  // test bodies yield* FSUtil.Service directly too — provideMerge (not
  // provide) so deps' own outputs stay visible downstream instead of being
  // consumed-and-hidden behind Loop.layer's output.
  return Loop.layer.pipe(Layer.provide(promptLayer), Layer.provideMerge(deps))
}

function makeHttp() {
  return Layer.mergeAll(TestLLMServer.layer, makeLoop())
}

const it = testEffect(makeHttp())

// Config that registers a custom "test" provider with a "test-model" model so
// provider/model default resolution succeeds inside the loop, matching
// session/prompt.test.ts's provider fixture.
function providerCfg(url: string): Partial<ConfigV1.Info> {
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
  }
}

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    `${dir}/opencode.json`,
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

const waitForTerminal = (id: Loop.LoopID) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const loop = yield* Loop.Service
      const info = yield* loop.get(id)
      if (!info) return undefined
      return info.status !== "running" && info.status !== "paused" ? info : undefined
    }),
    `loop ${id} never reached a terminal status`,
    "5 seconds",
  )

it.instance(
  "completes when an iteration's output contains the promise token",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      const loop = yield* Loop.Service

      yield* llm.text("all done <promise>COMPLETE</promise>")

      const info = yield* loop.create({ prompt: "do the thing", maxIterations: 5, interval: 0 })
      const final = yield* waitForTerminal(info.id)

      expect(final.status).toBe("completed")
      expect(final.iterations).toHaveLength(1)
      expect(final.iterations[0]?.complete).toBe(true)
    }),
  { config: {} },
)

it.instance(
  "caps a runaway loop at max iterations when the no-progress guard is disabled",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      const loop = yield* Loop.Service

      yield* llm.text("iteration one, no signal yet")
      yield* llm.text("iteration two, no signal yet")
      yield* llm.text("iteration three, no signal yet")

      const info = yield* loop.create({
        prompt: "keep trying",
        maxIterations: 3,
        interval: 0,
        noProgressLimit: 0,
      })
      const final = yield* waitForTerminal(info.id)

      expect(final.status).toBe("max_reached")
      expect(final.iterations).toHaveLength(3)
    }),
  { config: {} },
)

it.instance(
  "stalls after consecutive no-tool-call near-identical iterations",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      const loop = yield* Loop.Service

      yield* llm.text("nothing new to report here")
      yield* llm.text("nothing new to report here")
      yield* llm.text("nothing new to report here")

      const info = yield* loop.create({
        prompt: "watch for changes",
        maxIterations: 10,
        interval: 0,
        noProgressLimit: 3,
      })
      const final = yield* waitForTerminal(info.id)

      expect(final.status).toBe("stalled")
      expect(final.iterations).toHaveLength(3)
    }),
  { config: {} },
)

it.instance(
  "runs iterations in the caller's session when sessionID is given",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      const loop = yield* Loop.Service
      const session = yield* Session.Service

      const existing = yield* session.create({ title: "my working session" })

      yield* llm.text("all done <promise>COMPLETE</promise>")

      const info = yield* loop.create({
        prompt: "do the thing",
        sessionID: existing.id,
        maxIterations: 5,
        interval: 0,
      })
      expect(info.sessionID).toBe(existing.id)
      expect(info.directory).toBe(existing.directory)

      const final = yield* waitForTerminal(info.id)
      expect(final.status).toBe("completed")
      expect(final.iterations).toHaveLength(1)
      // The iteration ran inside the given session — no loop-owned session
      // was created for it.
      expect(final.iterations[0]?.sessionID).toBe(existing.id)
      const sessions = yield* session.list()
      expect(sessions.filter((item) => item.title?.startsWith("loop:"))).toHaveLength(0)
    }),
  { config: {} },
)

it.instance(
  "pause, resume, and cancel transition loop status",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      const loop = yield* Loop.Service

      yield* llm.text("still working, iteration one")

      const info = yield* loop.create({ prompt: "long running task", maxIterations: 10, interval: 0 })

      // Let one iteration land before exercising pause/resume/cancel so the
      // status transitions below aren't racing the loop's very first tick.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* loop.get(info.id)
          return current && current.iterations.length >= 1 ? current : undefined
        }),
        "loop never completed its first iteration",
        "5 seconds",
      )

      const paused = yield* loop.pause(info.id)
      expect(paused).toBe(true)
      const afterPause = yield* loop.get(info.id)
      expect(afterPause?.status).toBe("paused")

      const resumed = yield* loop.resume(info.id)
      expect(resumed).toBe(true)
      const afterResume = yield* loop.get(info.id)
      expect(afterResume?.status).toBe("running")

      const cancelled = yield* loop.cancel(info.id)
      expect(cancelled).toBe(true)
      const afterCancel = yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* loop.get(info.id)
          return current?.status === "cancelled" ? current : undefined
        }),
        "loop never reached cancelled status",
        "5 seconds",
      )
      expect(afterCancel.status).toBe("cancelled")
    }),
  { config: {} },
)
