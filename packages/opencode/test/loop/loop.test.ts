import { MessageV2 } from "../../src/session/message-v2"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { NodeFileSystem } from "@effect/platform-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { AutoMode } from "@/auto-mode/service"
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
import { reply, TestLLMServer } from "../lib/llm-server"
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
    instructions: () => Effect.succeed([]),
    resourceTemplates: () => Effect.succeed({}),
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


// Mirrors upstream's session/prompt.test.ts harness: ONE node graph compiled
// once, with mocks injected as node replacements. Building each service
// separately and merging does not work — AppNodeBuilder.build() returns a
// closed layer, so every call constructs its own Database and a session
// written through one is invisible to the others.
const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })
const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const loopRoot = LayerNode.group([
  Loop.node,
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  AutoMode.node,
  RuntimeFlags.node,
  SessionSummary.node,
])

function makeLoop() {
  return LayerNode.compile(loopRoot, [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [RuntimeFlags.node, runtimeFlags],
  ])
}

function makeHttp() {
  return LayerNode.compile(LayerNode.group([loopRoot, testLLMServerNode]), [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [RuntimeFlags.node, runtimeFlags],
  ])
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

const waitForTerminal = (id: Loop.LoopID, seconds = 5) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const loop = yield* Loop.Service
      const info = yield* loop.get(id)
      if (!info) return undefined
      return info.status !== "running" && info.status !== "paused" ? info : undefined
    }),
    `loop ${id} never reached a terminal status`,
    `${seconds} seconds`,
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
      // The iteration ran in the caller's own session, where the user can
      // actually watch it — not in a hidden child. No loop-owned session was
      // created either.
      expect(final.iterations[0]?.sessionID).toBe(existing.id)
      expect(final.iterationSessionID).toBe(existing.id)
      const sessions = yield* session.list()
      expect(sessions.filter((item) => item.title?.startsWith("loop:"))).toHaveLength(0)
    }),
  { config: {} },
)

it.instance(
  "cancel mid-iteration aborts the turn and wins the race against late completion",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      const loop = yield* Loop.Service

      // The provider holds the response open until we release it — an
      // iteration that is genuinely in flight when cancel arrives.
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      yield* llm.push(reply().wait(gate).text("all done <promise>COMPLETE</promise>").stop())

      const info = yield* loop.create({ prompt: "long task", maxIterations: 3, interval: 0 })

      yield* pollWithTimeout(
        Effect.gen(function* () {
          const hits = yield* llm.hits
          return hits.length > 0 ? true : undefined
        }),
        "iteration request never reached the mock provider",
        "10 seconds",
      )

      const cancelled = yield* loop.cancel(info.id)
      expect(cancelled).toBe(true)
      const afterCancel = yield* loop.get(info.id)
      expect(afterCancel?.status).toBe("cancelled")
      const finishedAt = afterCancel?.finishedAt

      // Late completion: the provider finally delivers the token. The loop's
      // terminal status is sticky — cancelled stays cancelled, finishedAt is
      // not rewritten.
      release()
      yield* Effect.sleep("1 second")

      const final = yield* loop.get(info.id)
      expect(final?.status).toBe("cancelled")
      expect(final?.finishedAt).toBe(finishedAt!)
    }),
  { config: {} },
)

it.instance(
  "does not consume the iteration budget while the session is busy with a foreign turn",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      const loop = yield* Loop.Service
      const session = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      const existing = yield* session.create({ title: "chat" })

      // A turn this loop did not start — e.g. the user's own message sent
      // just before starting the loop — held open until we release it.
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      yield* llm.hold("manual reply", gate)
      yield* prompt
        .prompt({ sessionID: existing.id, parts: [{ type: "text", text: "manual message" }] })
        .pipe(Effect.forkChild)
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const hits = yield* llm.hits
          return hits.length > 0 ? true : undefined
        }),
        "manual turn never reached the mock provider",
        "10 seconds",
      )

      // Queued for once the foreign turn frees the session up and the
      // loop's own first iteration actually runs.
      yield* llm.text("all done <promise>COMPLETE</promise>")

      const info = yield* loop.create({
        prompt: "do the thing",
        sessionID: existing.id,
        maxIterations: 3,
        interval: 0.05,
      })

      // Old behaviour: the foreign-turn guard tripped roughly every 50ms and
      // each trip advanced info.iteration anyway, so all 3 max iterations
      // were burned well inside this window — the loop finalized
      // "max_reached" without the manual turn ever finishing, and without
      // ever sending its own prompt.
      yield* Effect.sleep("500 millis")
      const midFlight = yield* loop.get(info.id)
      expect(midFlight?.status).toBe("running")
      expect(midFlight?.iteration).toBe(0)

      release()
      const final = yield* waitForTerminal(info.id)
      expect(final.status).toBe("completed")
      expect(final.iteration).toBe(1)
      expect(final.iterations).toHaveLength(1)
    }),
  { config: {} },
)

it.instance(
  "a stalled iteration gets a directive continuation prompt, in the visible session",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      const loop = yield* Loop.Service

      // Two short no-tool-call outputs (a stall), then a completion.
      yield* llm.text("on it")
      yield* llm.text("on it")
      yield* llm.text("all finished <promise>COMPLETE</promise>")

      const info = yield* loop.create({
        prompt: "fix the flaky test",
        maxIterations: 5,
        interval: 0,
        noProgressLimit: 0,
      })
      const final = yield* waitForTerminal(info.id)
      expect(final.status).toBe("completed")
      expect(final.iterations.length).toBeGreaterThanOrEqual(3)

      // Every iteration ran in the one session the user is watching.
      const iterationSessions = new Set(final.iterations.map((i) => i.sessionID))
      expect(iterationSessions.size).toBe(1)

      // The iteration after a stall carries the directive, prepended to the
      // user's own prompt (which must never be lost).
      const hits = yield* llm.hits
      const bodies = hits.map((h) => JSON.stringify(h.body))
      const directive = bodies.filter((b) => b.includes("used no tools"))
      expect(directive.length).toBeGreaterThanOrEqual(1)
      for (const body of directive) expect(body).toContain("fix the flaky test")
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

it.instance(
  "a multi-step turn reports its real tool-call count and is not scored as a stall",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      // auto_mode so the glob tool's permission ask does not block an
      // unattended iteration — the way a real loop runs.
      yield* writeConfig(dir, { ...providerCfg(llm.url), auto_mode: true })
      const loop = yield* Loop.Service

      // Iteration 1 is a MULTI-STEP turn: a tool call in the first step, then
      // prose in the second. `promptSvc.prompt` resolves to that last, tool-less
      // message — which is exactly how the count used to come back as 0.
      yield* llm.tool("glob", { pattern: "*.ts" })
      yield* llm.text("I searched the tree and will keep going")
      // Iteration 2 finishes, so the loop has a clean terminal state.
      yield* llm.text("all done <promise>COMPLETE</promise>")

      const info = yield* loop.create({
        prompt: "look around then finish",
        maxIterations: 4,
        interval: 0,
        // A stall verdict after a single no-tool iteration: if the multi-step
        // turn were still counted as 0 tool calls, this loop would end `stalled`
        // instead of reaching iteration 2.
        noProgressLimit: 1,
      })
      const final = yield* waitForTerminal(info.id, 20)

      expect(final.status).toBe("completed")
      expect(final.iterations[0]?.toolCalls).toBeGreaterThanOrEqual(1)
      expect(final.iterations.length).toBeGreaterThanOrEqual(2)
    }),
  { config: {} },
)
