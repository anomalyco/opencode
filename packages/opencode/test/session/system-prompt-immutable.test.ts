/**
 * TDD tests verifying the system prompt is frozen for the lifetime of a
 * session. Once the first LLM call is made, every subsequent call must reuse
 * the same system prompt text — regardless of AGENTS.md edits, custom
 * instruction file edits, changes to git status / workspace root, or the
 * calendar date rolling over at midnight.
 *
 * All tests currently FAIL because the implementation rebuilds every component
 * of the system prompt on each LLM call rather than caching it per-session.
 */

import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { expect } from "bun:test"
import { test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import path from "path"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Format } from "../../src/format"
import { TestInstance, withTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Agent } from "../../src/agent/agent"
import type { Provider } from "@/provider/provider"

// ---------------------------------------------------------------------------
// Service stubs (same pattern as prompt.test.ts)
// ---------------------------------------------------------------------------

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

const status = SessionStatus.layer.pipe(Layer.provideMerge(EventV2Bridge.defaultLayer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

// ---------------------------------------------------------------------------
// Layer builders
// ---------------------------------------------------------------------------

function makeLayer(systemPromptLayer: Layer.Layer<SystemPrompt.Service> = SystemPrompt.defaultLayer) {
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
  return SessionPrompt.layer.pipe(
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(summary),
    Layer.provideMerge(run),
    Layer.provideMerge(compact),
    Layer.provideMerge(proc),
    Layer.provideMerge(registry),
    Layer.provideMerge(trunc),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(systemPromptLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
    Layer.provide(summary),
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

function providerCfg(url: string) {
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

const writeText = Effect.fn("test.writeText")(function* (filepath: string, text: string) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(filepath, text)
})

/** Extract system-role message text from a captured LLM request body. */
function systemContent(body: Record<string, unknown>): string {
  const messages = body.messages
  if (!Array.isArray(messages)) return ""
  return messages
    .filter((m): m is { role: string; content: string } => m && typeof m === "object" && m.role === "system")
    .map((m) => m.content)
    .join("\n")
}

/** Add a user message to a session and return it. */
const sendUserMessage = Effect.fn("test.sendUserMessage")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

/** Filter auto-title LLM calls from captured inputs, leaving only chat turns. */
function chatInputs(inputs: Record<string, unknown>[]): Record<string, unknown>[] {
  return inputs.filter((b) => !JSON.stringify(b).includes("Generate a title"))
}

// ---------------------------------------------------------------------------
// Shared test body: assert that two consecutive prompt.loop calls produce
// identical system prompts.
// ---------------------------------------------------------------------------

const assertSystemPromptIsIdenticalAcrossTurns = Effect.fn(
  "test.assertSystemPromptIsIdenticalAcrossTurns",
)(function* (opts: {
  // Receives both the tmpdir path and the LLM server URL so setupDir can
  // write an opencode.json that includes the provider config alongside any
  // custom instructions.
  setupDir: (dir: string, llmUrl: string) => Effect.Effect<void, Error, FSUtil.Service>
  mutateBetweenTurns: Effect.Effect<void, Error, FSUtil.Service | TestInstance>
}) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  const prompt = yield* SessionPrompt.Service
  const sessions = yield* Session.Service
  const config = yield* Config.Service

  yield* opts.setupDir(dir, llm.url)
  yield* config.get()

  const chat = yield* sessions.create({ title: "Immutable System Prompt Test" })

  yield* sendUserMessage(chat.id, "first message")
  yield* llm.text("response one")
  yield* prompt.loop({ sessionID: chat.id })

  yield* opts.mutateBetweenTurns

  yield* sendUserMessage(chat.id, "second message")
  yield* llm.text("response two")
  yield* prompt.loop({ sessionID: chat.id })

  const inputs = yield* llm.inputs
  const turns = chatInputs(inputs)
  expect(turns).toHaveLength(2)

  const sys1 = systemContent(turns[0])
  const sys2 = systemContent(turns[1])

  // The system prompt must be identical across both turns.
  expect(sys1).toBe(sys2)
})

// ---------------------------------------------------------------------------
// Tests using the default (real) SystemPrompt layer
// ---------------------------------------------------------------------------

const it = testEffect(Layer.mergeAll(TestLLMServer.layer, makeLayer()))

/**
 * When AGENTS.md changes after the first LLM call in a session, subsequent
 * calls should still use the original AGENTS.md content captured at session
 * start. Currently FAILS: instruction.system() reads the file from disk on
 * every call so the second turn picks up the mutated content.
 */
it.instance(
  "system prompt instructions do not change when AGENTS.md is updated mid-session",
  () =>
    assertSystemPromptIsIdenticalAcrossTurns({
      setupDir: (dir, llmUrl) =>
        Effect.gen(function* () {
          yield* writeText(
            path.join(dir, "opencode.json"),
            JSON.stringify({ $schema: "https://opencode.ai/config.json", ...providerCfg(llmUrl) }),
          )
          yield* writeText(path.join(dir, "AGENTS.md"), "# Session Rules\n\nSEMICOLON_POLICY: always use semicolons")
        }),
      mutateBetweenTurns: Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        yield* writeText(path.join(dir, "AGENTS.md"), "# Session Rules\n\nSEMICOLON_POLICY: never use semicolons")
      }),
    }),
  { config: {} },
  15_000,
)

/**
 * When a custom instruction file referenced in opencode.json changes after the
 * first LLM call, the system prompt must not change. Currently FAILS:
 * instruction.system() re-reads all instruction files on every call.
 */
it.instance(
  "system prompt instructions do not change when a custom instruction file is updated mid-session",
  () =>
    assertSystemPromptIsIdenticalAcrossTurns({
      setupDir: (dir, llmUrl) =>
        Effect.gen(function* () {
          yield* writeText(path.join(dir, "custom-rules.md"), "CUSTOM_POLICY: always lint before commit")
          yield* writeText(
            path.join(dir, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              ...providerCfg(llmUrl),
              instructions: [path.join(dir, "custom-rules.md")],
            }),
          )
        }),
      mutateBetweenTurns: Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        yield* writeText(path.join(dir, "custom-rules.md"), "CUSTOM_POLICY: never lint before commit")
      }),
    }),
  { config: {} },
  15_000,
)

// ---------------------------------------------------------------------------
// Tests using a mocked SystemPrompt.Service so we can control what
// environment() returns without waiting for real OS changes (midnight, git).
//
// Because the mock layer must be built per-test (it wraps a per-test mutable
// cell), these tests use raw `test()` and build+run their own Effect runtime
// rather than going through `testEffect(…).instance(…)`.
// ---------------------------------------------------------------------------

type EnvCell = { current: string[] }

/**
 * Build a SystemPrompt.Service backed by a mutable cell so a test can swap
 * the environment string between turns to simulate midnight / git-init.
 */
function makeControllableSystemPromptLayer(cell: EnvCell) {
  return Layer.succeed(
    SystemPrompt.Service,
    SystemPrompt.Service.of({
      environment: (_model: Provider.Model) => Effect.sync(() => cell.current),
      skills: (_agent: Agent.Info) => Effect.succeed(undefined),
    }),
  )
}

/**
 * Run a test body against a freshly-built layer that includes a controllable
 * SystemPrompt wired to `cell`. The body receives an isolated tmpdir instance.
 */
function runWithCell(
  cell: EnvCell,
  body: Effect.Effect<void, unknown, SessionPrompt.Service | Session.Service | Config.Service | TestLLMServer | TestInstance | FSUtil.Service>,
): Promise<void> {
  const layer = Layer.mergeAll(TestLLMServer.layer, makeLayer(makeControllableSystemPromptLayer(cell)))
  return Effect.gen(function* () {
    const exit = yield* body.pipe(
      withTmpdirInstance(),
      Effect.scoped,
      Effect.provide(layer),
      Effect.exit,
    )
    if (Exit.isFailure(exit)) {
      for (const err of Cause.prettyErrors(exit.cause)) {
        yield* Effect.logError(err)
      }
    }
    return yield* exit
  }).pipe(Effect.runPromise)
}

/**
 * When the date changes (e.g. midnight rolls over), the system prompt env
 * block must not change for an in-progress session. Currently FAILS because
 * environment() calls new Date().toDateString() on every LLM request.
 */
test(
  "system prompt date does not change when date advances mid-session",
  () => {
    const cell: EnvCell = { current: ["Today's date: Mon Jan 01 2025\nIs directory a git repo: no"] }
    return runWithCell(
      cell,
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const llm = yield* TestLLMServer
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const config = yield* Config.Service

        yield* writeText(
          path.join(dir, "opencode.json"),
          JSON.stringify({ $schema: "https://opencode.ai/config.json", ...providerCfg(llm.url) }),
        )
        yield* config.get()

        const chat = yield* sessions.create({ title: "Date Freeze Test" })

        yield* sendUserMessage(chat.id, "first message")
        yield* llm.text("response one")
        yield* prompt.loop({ sessionID: chat.id })

        // Simulate midnight: date rolls to the next day.
        cell.current = ["Today's date: Tue Jan 02 2025\nIs directory a git repo: no"]

        yield* sendUserMessage(chat.id, "second message")
        yield* llm.text("response two")
        yield* prompt.loop({ sessionID: chat.id })

        const inputs = yield* llm.inputs
        const turns = chatInputs(inputs)
        expect(turns).toHaveLength(2)

        const sys1 = systemContent(turns[0])
        const sys2 = systemContent(turns[1])

        // Currently FAILS: environment() is called fresh each turn, so the
        // second request carries the advanced date instead of the frozen one.
        expect(sys1).toBe(sys2)
        expect(sys1).toContain("Mon Jan 01 2025")
      }),
    )
  },
  15_000,
)

/**
 * When git is initialised in the working directory after the first LLM call
 * (or workspace root changes), the system prompt env block must not change.
 * Currently FAILS because environment() reads InstanceState.context live on
 * every request, picking up the updated vcs flag.
 */
test(
  "system prompt env block does not change when git status changes mid-session",
  () => {
    const cell: EnvCell = { current: ["Working directory: /project\nIs directory a git repo: no"] }
    return runWithCell(
      cell,
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const llm = yield* TestLLMServer
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const config = yield* Config.Service

        yield* writeText(
          path.join(dir, "opencode.json"),
          JSON.stringify({ $schema: "https://opencode.ai/config.json", ...providerCfg(llm.url) }),
        )
        yield* config.get()

        const chat = yield* sessions.create({ title: "Git Status Freeze Test" })

        yield* sendUserMessage(chat.id, "first message")
        yield* llm.text("response one")
        yield* prompt.loop({ sessionID: chat.id })

        // Simulate git init: workspace becomes a git repo mid-session.
        cell.current = ["Working directory: /project\nIs directory a git repo: yes"]

        yield* sendUserMessage(chat.id, "second message")
        yield* llm.text("response two")
        yield* prompt.loop({ sessionID: chat.id })

        const inputs = yield* llm.inputs
        const turns = chatInputs(inputs)
        expect(turns).toHaveLength(2)

        const sys1 = systemContent(turns[0])
        const sys2 = systemContent(turns[1])

        // Currently FAILS: environment() is called fresh each turn, so the
        // second request reflects the new git status instead of the frozen one.
        expect(sys1).toBe(sys2)
        expect(sys1).toContain("Is directory a git repo: no")
      }),
    )
  },
  15_000,
)
