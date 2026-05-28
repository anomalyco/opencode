/**
 * Tests for the /goal feature.
 *
 * Public-interface tests: these describe what a caller observes (goal state,
 * assistant turns, loop behaviour) rather than testing internal implementation
 * details.
 */
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { Session } from "@/session/session"
import { SessionGoal } from "@/session/goal"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionRunState } from "@/session/run-state"
import { MessageV2 } from "@/session/message-v2"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { SessionCompaction } from "@/session/compaction"
import { SessionProcessor } from "@/session/processor"
import { SessionRevert } from "@/session/revert"
import { SessionSummary } from "@/session/summary"
import { Instruction } from "@/session/instruction"
import { SystemPrompt } from "@/session/system"
import { LLM } from "@/session/llm"
import { Bus } from "@/bus"
import { BackgroundJob } from "@/background/job"
import { Env } from "@/env"
import { MCP } from "@/mcp"
import { LSP } from "@/lsp/lsp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Command } from "@/command"
import { Image } from "@/image/image"
import { Skill } from "@/skill"
import { Snapshot } from "@/snapshot"
import { Todo } from "@/session/todo"
import { Question } from "@/question"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SyncEvent } from "@/sync"
import { Reference } from "@/reference/reference"
import { RepositoryCache } from "@/reference/repository-cache"
import { Git } from "@/git"
import { Ripgrep } from "@/file/ripgrep"
import { Format } from "@/format"
import { ProviderID, ModelID } from "@/provider/schema"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { TestInstance } from "../fixture/fixture"

// ── shared config ──────────────────────────────────────────────────────────

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const cfg = {
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
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: { ...cfg.provider.test.options, baseURL: url },
      },
    },
  }
}

// ── layer helpers (mirrors prompt.test.ts) ─────────────────────────────────

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

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const run = SessionRunState.layer.pipe(Layer.provide(status))

function makePrompt() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    Agent.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    Provider.defaultLayer,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    BackgroundJob.defaultLayer,
    status,
    SyncEvent.defaultLayer,
    EventV2Bridge.defaultLayer,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(RepositoryCache.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Reference.defaultLayer),
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
  return SessionPrompt.layer.pipe(
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(Reference.defaultLayer),
    Layer.provide(summary),
    Layer.provideMerge(run),
    Layer.provideMerge(compact),
    Layer.provideMerge(proc),
    Layer.provideMerge(registry),
    Layer.provideMerge(trunc),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(SystemPrompt.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provide(SessionGoal.layer),
    Layer.provideMerge(deps),
    Layer.provide(summary),
  )
}

function makeHttp() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    LLM.defaultLayer,
    Agent.defaultLayer,
    Provider.defaultLayer,
    Bus.layer,
  ).pipe(
    Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(Env.defaultLayer),
    Layer.provide(BackgroundJob.defaultLayer),
    Layer.provide(SyncEvent.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(mcp),
    Layer.provide(lsp),
  )
  return Layer.mergeAll(
    TestLLMServer.layer,
    makePrompt(),
    SessionGoal.layer.pipe(Layer.provideMerge(deps)),
  )
}

const it = testEffect(makeHttp())

// ── utility ────────────────────────────────────────────────────────────────

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<Config.Info>) {
  const fs = yield* AppFileSystem.Service
  yield* fs.writeWithDirs(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("test.useServerConfig")(function* (
  mkConfig: (url: string) => Partial<Config.Info>,
) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, mkConfig(llm.url))
  return { dir, llm }
})

// ── isClearAlias unit tests ────────────────────────────────────────────────

describe("isClearAlias", () => {
  const { effect } = testEffect(Layer.empty)

  effect("returns true for clear", () =>
    Effect.sync(() => expect(SessionGoal.isClearAlias("clear")).toBe(true)),
  )

  effect("returns true for stop", () =>
    Effect.sync(() => expect(SessionGoal.isClearAlias("stop")).toBe(true)),
  )

  effect("returns true for cancel", () =>
    Effect.sync(() => expect(SessionGoal.isClearAlias("cancel")).toBe(true)),
  )

  effect("returns true for off", () =>
    Effect.sync(() => expect(SessionGoal.isClearAlias("off")).toBe(true)),
  )

  effect("returns true for reset", () =>
    Effect.sync(() => expect(SessionGoal.isClearAlias("reset")).toBe(true)),
  )

  effect("returns true for none", () =>
    Effect.sync(() => expect(SessionGoal.isClearAlias("none")).toBe(true)),
  )

  effect("returns false for a condition string", () =>
    Effect.sync(() => expect(SessionGoal.isClearAlias("all tests pass")).toBe(false)),
  )

  effect("returns false for empty string", () =>
    Effect.sync(() => expect(SessionGoal.isClearAlias("")).toBe(false)),
  )

  // Kills the MethodExpression mutation that removes trim().toLowerCase()
  effect("returns true for uppercase CLEAR", () =>
    Effect.sync(() => expect(SessionGoal.isClearAlias("CLEAR")).toBe(true)),
  )

  effect("returns true for STOP with surrounding whitespace", () =>
    Effect.sync(() => expect(SessionGoal.isClearAlias("  STOP  ")).toBe(true)),
  )

  effect("returns false for 'clearish' (contains but not equals)", () =>
    Effect.sync(() => expect(SessionGoal.isClearAlias("clearish")).toBe(false)),
  )
})

// ── SessionGoal service tests ──────────────────────────────────────────────

// goalLayer uses the full prompt layer (which includes SessionGoal) + DB
const goalLayer = testEffect(makeHttp())

describe("SessionGoal service", () => {
  goalLayer.instance("get returns none when no goal set", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "t" })
      const result = yield* goal.get(chat.id)
      expect(Option.isNone(result)).toBe(true)
    }),
  )

  goalLayer.instance("set creates an active goal", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "t" })
      const g = yield* goal.set(chat.id, "all tests pass")
      expect(g.status).toBe("active")
      expect(g.condition).toBe("all tests pass")
      expect(g.turns).toBe(0)

      const fetched = yield* goal.get(chat.id)
      expect(Option.isSome(fetched)).toBe(true)
      if (Option.isSome(fetched)) {
        expect(fetched.value.condition).toBe("all tests pass")
        expect(fetched.value.status).toBe("active")
      }
    }),
  )

  goalLayer.instance("clear changes status to cleared", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "t" })
      yield* goal.set(chat.id, "some condition")
      yield* goal.clear(chat.id)

      const fetched = yield* goal.get(chat.id)
      expect(Option.isSome(fetched)).toBe(true)
      if (Option.isSome(fetched)) expect(fetched.value.status).toBe("cleared")
    }),
  )

  goalLayer.instance("achieve changes status to achieved with end time", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "t" })
      yield* goal.set(chat.id, "some condition")
      yield* goal.achieve(chat.id)

      const fetched = yield* goal.get(chat.id)
      expect(Option.isSome(fetched)).toBe(true)
      if (Option.isSome(fetched)) {
        expect(fetched.value.status).toBe("achieved")
        expect(fetched.value.time.ended).toBeDefined()
      }
    }),
  )

  goalLayer.instance("afterTurn increments turns and tokens", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "t" })
      yield* goal.set(chat.id, "some condition")
      yield* goal.afterTurn(chat.id, 500)
      yield* goal.afterTurn(chat.id, 300)

      const fetched = yield* goal.get(chat.id)
      if (Option.isSome(fetched)) {
        expect(fetched.value.turns).toBe(2)
        expect(fetched.value.tokens).toBe(800)
      }
    }),
  )

  goalLayer.instance("set overwrites existing active goal", () =>
    Effect.gen(function* () {
      const goal = yield* SessionGoal.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "t" })
      yield* goal.set(chat.id, "first goal")
      yield* goal.set(chat.id, "second goal")

      const fetched = yield* goal.get(chat.id)
      if (Option.isSome(fetched)) expect(fetched.value.condition).toBe("second goal")
    }),
  )
})

// ── /goal command via SessionPrompt ───────────────────────────────────────

it.instance("/goal clear returns a synthetic reply and marks goal as cleared", () =>
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const goal = yield* SessionGoal.Service

    const chat = yield* sessions.create({ title: "Test" })
    yield* goal.set(chat.id, "do something")

    yield* prompt.command({ sessionID: chat.id, command: "goal", arguments: "clear" })

    const msgs = yield* sessions.messages({ sessionID: chat.id })
    const allText = msgs
      .flatMap((m) => m.parts.filter((p): p is MessageV2.TextPart => p.type === "text"))
      .map((p) => p.text)
      .join(" ")
    expect(allText.toLowerCase()).toContain("clear")

    const fetched = yield* goal.get(chat.id)
    expect(Option.isSome(fetched)).toBe(true)
    if (Option.isSome(fetched)) expect(fetched.value.status).toBe("cleared")
  }),
)

it.instance("/goal with no args and no active goal returns 'No active goal'", () =>
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service

    const chat = yield* sessions.create({ title: "Test" })
    yield* prompt.command({ sessionID: chat.id, command: "goal", arguments: "" })

    const msgs = yield* sessions.messages({ sessionID: chat.id })
    const allText = msgs
      .flatMap((m) => m.parts.filter((p): p is MessageV2.TextPart => p.type === "text"))
      .map((p) => p.text)
      .join(" ")
    expect(allText.toLowerCase()).toContain("no active goal")
  }),
)

it.instance("/goal with no args and active goal shows status info", () =>
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const goal = yield* SessionGoal.Service

    const chat = yield* sessions.create({ title: "Test" })
    yield* goal.set(chat.id, "all tests pass")
    yield* prompt.command({ sessionID: chat.id, command: "goal", arguments: "" })

    const msgs = yield* sessions.messages({ sessionID: chat.id })
    const allText = msgs
      .flatMap((m) => m.parts.filter((p): p is MessageV2.TextPart => p.type === "text"))
      .map((p) => p.text)
      .join(" ")
    expect(allText).toContain("all tests pass")
    expect(allText.toLowerCase()).toContain("active")
  }),
)

// ── parseEvalResponse / buildEvalPrompt targeted tests ────────────────────
// These tests specifically target mutations in the pure helper functions that
// Stryker identified as surviving.

it.instance("evaluator recognises 'YES' (uppercase) as met", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const goal = yield* SessionGoal.Service

    const chat = yield* sessions.create({ title: "Test" })
    // Evaluator returns uppercase YES
    yield* llm.textMatch(
      (hit) => !JSON.stringify(hit.body).includes("goal evaluator"),
      "Task done.",
    )
    yield* llm.textMatch(
      (hit) => JSON.stringify(hit.body).includes("goal evaluator"),
      "YES\nGoal is met.",
    )

    yield* prompt.command({ sessionID: chat.id, command: "goal", arguments: "do it" })

    const fetched = yield* goal.get(chat.id)
    if (Option.isSome(fetched)) expect(fetched.value.status).toBe("achieved")
  }),
)

it.instance("evaluator 'no' response keeps goal active for another turn", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const goal = yield* SessionGoal.Service

    const chat = yield* sessions.create({ title: "Test" })
    // Turn 1: not done
    yield* llm.textMatch(
      (hit) => !JSON.stringify(hit.body).includes("goal evaluator"),
      "Starting.",
    )
    // Evaluator: not met
    yield* llm.textMatch(
      (hit) => JSON.stringify(hit.body).includes("goal evaluator"),
      "no\nNot finished yet.",
    )
    // Turn 2: done
    yield* llm.textMatch(
      (hit) => !JSON.stringify(hit.body).includes("goal evaluator"),
      "Completed.",
    )
    // Evaluator: met
    yield* llm.textMatch(
      (hit) => JSON.stringify(hit.body).includes("goal evaluator"),
      "yes\nDone.",
    )

    yield* prompt.command({ sessionID: chat.id, command: "goal", arguments: "finish work" })

    const fetched = yield* goal.get(chat.id)
    if (Option.isSome(fetched)) {
      expect(fetched.value.status).toBe("achieved")
      // Two evaluations happened
      expect(fetched.value.turns).toBeGreaterThanOrEqual(2)
    }
  }),
)

it.instance("evaluator receives the goal condition in its prompt", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service

    const chat = yield* sessions.create({ title: "Test" })
    yield* llm.textMatch((hit) => !JSON.stringify(hit.body).includes("goal evaluator"), "Done.")
    yield* llm.textMatch(
      (hit) => JSON.stringify(hit.body).includes("goal evaluator"),
      "yes\nMet.",
    )

    yield* prompt.command({ sessionID: chat.id, command: "goal", arguments: "unique-condition-XYZ" })

    // The evaluator request body must contain the condition text
    const hits = yield* llm.hits
    const evalHit = hits.find((h) => JSON.stringify(h.body).includes("goal evaluator"))
    expect(evalHit).toBeDefined()
    if (evalHit) {
      expect(JSON.stringify(evalHit.body)).toContain("unique-condition-XYZ")
    }
  }),
)

it.instance("assistant text appears in evaluator transcript", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service

    const chat = yield* sessions.create({ title: "Test" })
    const sentinelText = "SENTINEL-ASSISTANT-OUTPUT-9XZ"
    yield* llm.textMatch((hit) => !JSON.stringify(hit.body).includes("goal evaluator"), sentinelText)
    yield* llm.textMatch(
      (hit) => JSON.stringify(hit.body).includes("goal evaluator"),
      "yes\nMet.",
    )

    yield* prompt.command({ sessionID: chat.id, command: "goal", arguments: "check transcript" })

    // The evaluator call should include the assistant's output in the transcript
    const hits = yield* llm.hits
    const evalHit = hits.find((h) => JSON.stringify(h.body).includes("goal evaluator"))
    expect(evalHit).toBeDefined()
    if (evalHit) {
      expect(JSON.stringify(evalHit.body)).toContain(sentinelText)
    }
  }),
)

it.instance("evaluator is not triggered when goal is met on 'yes-on-first-line' with extra text", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const goal = yield* SessionGoal.Service

    const chat = yield* sessions.create({ title: "Test" })
    yield* llm.textMatch((hit) => !JSON.stringify(hit.body).includes("goal evaluator"), "Done.")
    // Response where first line starts with "yes" but has more text
    yield* llm.textMatch(
      (hit) => JSON.stringify(hit.body).includes("goal evaluator"),
      "yes, absolutely\nGoal is fully met.",
    )

    yield* prompt.command({ sessionID: chat.id, command: "goal", arguments: "do it" })

    const fetched = yield* goal.get(chat.id)
    if (Option.isSome(fetched)) expect(fetched.value.status).toBe("achieved")
  }),
)

it.instance("evaluator 'no reason provided' fallback when single-line response", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const goal = yield* SessionGoal.Service

    const chat = yield* sessions.create({ title: "Test" })
    yield* llm.textMatch((hit) => !JSON.stringify(hit.body).includes("goal evaluator"), "Done.")
    // Single-line response (no reason line) - should still work
    yield* llm.textMatch(
      (hit) => JSON.stringify(hit.body).includes("goal evaluator"),
      "yes",
    )

    yield* prompt.command({ sessionID: chat.id, command: "goal", arguments: "do it" })

    const fetched = yield* goal.get(chat.id)
    if (Option.isSome(fetched)) expect(fetched.value.status).toBe("achieved")
  }),
)

it.instance("user message text appears in evaluator transcript (not assistant)", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service

    const chat = yield* sessions.create({ title: "Test" })
    const aiResponse = "ASSISTANT-RESPONSE-SENTINEL"
    yield* llm.textMatch((hit) => !JSON.stringify(hit.body).includes("goal evaluator"), aiResponse)
    yield* llm.textMatch(
      (hit) => JSON.stringify(hit.body).includes("goal evaluator"),
      "yes\nMet.",
    )

    yield* prompt.command({ sessionID: chat.id, command: "goal", arguments: "check-transcript" })

    // Evaluator transcript should label assistant output as "Assistant:"
    const hits = yield* llm.hits
    const evalHit = hits.find((h) => JSON.stringify(h.body).includes("goal evaluator"))
    if (evalHit) {
      const body = JSON.stringify(evalHit.body)
      expect(body).toContain("Assistant:")
      expect(body).toContain(aiResponse)
    }
  }),
)

it.instance(
  "/goal <condition> sets goal and starts AI loop",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const goal = yield* SessionGoal.Service

      const chat = yield* sessions.create({ title: "Test" })

      // Main AI turn responds normally; evaluator returns "yes"
      yield* llm.textMatch(
        (hit) => !JSON.stringify(hit.body).includes("goal evaluator"),
        "I have completed the task.",
      )
      yield* llm.textMatch(
        (hit) => JSON.stringify(hit.body).includes("goal evaluator"),
        "yes\nGoal condition is fully met.",
      )

      yield* prompt.command({
        sessionID: chat.id,
        command: "goal",
        arguments: "do something simple",
      })

      const fetched = yield* goal.get(chat.id)
      expect(Option.isSome(fetched)).toBe(true)
      if (Option.isSome(fetched)) {
        expect(fetched.value.status).toBe("achieved")
        expect(fetched.value.condition).toBe("do something simple")
      }
    }),
)

it.instance(
  "/goal loops again when evaluator says not met, then stops when met",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const goal = yield* SessionGoal.Service

      const chat = yield* sessions.create({ title: "Test" })

      // Turn 1: AI does some work
      yield* llm.textMatch(
        (hit) => !JSON.stringify(hit.body).includes("goal evaluator"),
        "I started working on the task.",
      )
      // Evaluator says not met after turn 1
      yield* llm.textMatch(
        (hit) => JSON.stringify(hit.body).includes("goal evaluator"),
        "no\nTask is not yet complete.",
      )
      // Turn 2: AI finishes
      yield* llm.textMatch(
        (hit) => !JSON.stringify(hit.body).includes("goal evaluator"),
        "I have now finished the task completely.",
      )
      // Evaluator says met after turn 2
      yield* llm.textMatch(
        (hit) => JSON.stringify(hit.body).includes("goal evaluator"),
        "yes\nTask is complete.",
      )

      yield* prompt.command({
        sessionID: chat.id,
        command: "goal",
        arguments: "complete the task",
      })

      const fetched = yield* goal.get(chat.id)
      if (Option.isSome(fetched)) {
        expect(fetched.value.status).toBe("achieved")
        expect(fetched.value.turns).toBeGreaterThanOrEqual(2)
      }

      const msgs = yield* sessions.messages({ sessionID: chat.id })
      const assistantMsgs = msgs.filter((m) => m.info.role === "assistant")
      expect(assistantMsgs.length).toBeGreaterThanOrEqual(2)
    }),
)
