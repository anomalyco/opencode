import { NodeFileSystem } from "@effect/platform-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { FetchHttpClient } from "effect/unstable/http"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Agent as AgentSvc } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Env } from "@/env"
import { Git } from "@/git"
import { Image } from "@/image/image"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Question } from "@/question"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Format } from "@/format"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { SessionPrompt } from "@/session/prompt"
import { SessionProcessor } from "@/session/processor"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { LLM } from "@/session/llm"
import { Instruction } from "@/session/instruction"
import { SystemPrompt } from "@/session/system"
import { McpLazyActivation } from "@/session/mcp-lazy"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SubagentLimits } from "@/session/subagent-limits"
import { Todo } from "@/session/todo"
import { Skill } from "@/skill"
import { Snapshot } from "@/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Workflow } from "@/workflow/workflow"
import { TestInstance, disposeAllInstances } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer, reply } from "../lib/llm-server"

// Issue 5 (per-task-timeout): a foreground task spawn carries an optional
// timeout (tool param or experimental.subagent_task_timeout). When it fires the
// subtree is aborted via the SAME cancel path as an explicit cancel
// (ops.cancel + background.cancel; the release-race fix 5582da5a8 stays intact):
// the child job ends cancelled, no orphan survives, and the foreground parent
// terminates cleanly with a typed SubagentTimeoutError in its transcript.

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

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
    startAuth: () => Effect.die("unexpected MCP auth in nested-timeout tests"),
    authenticate: () => Effect.die("unexpected MCP auth in nested-timeout tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in nested-timeout tests"),
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

// Full SessionPrompt stack against the fake LLM (mirrors nested-task.test.ts).
function makePrompt() {
  const flagLayer = () => RuntimeFlags.layer({ experimentalEventSystem: true })
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
    Layer.provide(flagLayer()),
    Layer.provide(Workflow.defaultLayer),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provide(flagLayer()),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer.pipe(
    Layer.provide(flagLayer()),
    Layer.provideMerge(proc),
    Layer.provideMerge(deps),
  )
  return SessionPrompt.layer.pipe(
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(McpLazyActivation.defaultLayer),
    Layer.provide(summary),
    Layer.provideMerge(run),
    Layer.provideMerge(compact),
    Layer.provideMerge(proc),
    Layer.provideMerge(registry),
    Layer.provideMerge(trunc),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(SystemPrompt.defaultLayer),
    Layer.provide(flagLayer()),
    Layer.provideMerge(deps),
    Layer.provide(summary),
  )
}

const it = testEffect(Layer.mergeAll(TestLLMServer.layer, makePrompt()))

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

function allowTaskCfg(url: string): Partial<ConfigV1.Info> {
  return { ...providerCfg(url), permission: { task: "allow" } }
}

const writeConfig = Effect.fn("NestedTimeoutTest.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("NestedTimeoutTest.useServerConfig")(function* (
  config: (url: string) => Partial<ConfigV1.Info>,
) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

const user = Effect.fn("NestedTimeoutTest.user")(function* (sessionID: SessionID, text: string) {
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

function task(prompt: string, extra?: Record<string, unknown>) {
  return {
    description: "delegate work",
    prompt,
    subagent_type: "general",
    ...extra,
  }
}

const finalText = (result: SessionV1.WithParts) => result.parts.findLast((part) => part.type === "text")?.text ?? ""

const firstChild = Effect.fn("NestedTimeoutTest.firstChild")(function* (sessionID: SessionID) {
  const sessions = yield* Session.Service
  return (yield* sessions.children(sessionID))[0]
})

const taskParts = Effect.fn("NestedTimeoutTest.taskParts")(function* (sessionID: SessionID) {
  const msgs = yield* MessageV2.filterCompactedEffect(sessionID)
  return msgs.flatMap((msg) =>
    msg.parts.filter((part): part is SessionV1.ToolPart => part.type === "tool" && part.tool === "task"),
  )
})

const errorTaskMessage = Effect.fn("NestedTimeoutTest.errorTaskMessage")(function* (sessionID: SessionID) {
  const parts = yield* taskParts(sessionID)
  const failed = parts.find((part) => part.state.status === "error")
  expect(failed?.state.status).toBe("error")
  return failed?.state.status === "error" ? failed.state.error : ""
})

const completedTaskOutput = Effect.fn("NestedTimeoutTest.completedTaskOutput")(function* (sessionID: SessionID) {
  const parts = yield* taskParts(sessionID)
  const completed = parts.find((part) => part.state.status === "completed")
  expect(completed?.state.status).toBe("completed")
  return completed?.state.status === "completed" ? completed.state.output : ""
})

// =============================================================================
// Pure helper: taskTimeout clamp (single source of truth in subagent-limits.ts)
// =============================================================================

describe("taskTimeout", () => {
  const cfg = (value?: number) =>
    ({ experimental: value === undefined ? {} : { subagent_task_timeout: value } }) as unknown as ConfigV1.Info

  test("undefined when no config default and no override", () => {
    expect(SubagentLimits.taskTimeout(cfg())).toBeUndefined()
    expect(SubagentLimits.taskTimeout({} as ConfigV1.Info)).toBeUndefined()
  })

  test("uses the config default in milliseconds", () => {
    expect(SubagentLimits.taskTimeout(cfg(5000))).toBe(5000)
  })

  test("the tool-param override wins over the config default", () => {
    expect(SubagentLimits.taskTimeout(cfg(5000), 1000)).toBe(1000)
    expect(SubagentLimits.taskTimeout(cfg(), 1000)).toBe(1000)
  })

  test("ignores non-positive / non-finite values (override and config)", () => {
    expect(SubagentLimits.taskTimeout(cfg(0))).toBeUndefined()
    expect(SubagentLimits.taskTimeout(cfg(-5))).toBeUndefined()
    expect(SubagentLimits.taskTimeout(cfg(Number.NaN))).toBeUndefined()
    expect(SubagentLimits.taskTimeout(cfg(Number.POSITIVE_INFINITY))).toBeUndefined()
    expect(SubagentLimits.taskTimeout(cfg(), 0)).toBeUndefined()
    expect(SubagentLimits.taskTimeout(cfg(), -1)).toBeUndefined()
    // An invalid override falls back to the config default rather than disabling.
    expect(SubagentLimits.taskTimeout(cfg(5000), 0)).toBe(5000)
  })

  test("truncates fractional milliseconds", () => {
    expect(SubagentLimits.taskTimeout(cfg(1500.9))).toBe(1500)
  })
})

describe("SubagentTimeoutError", () => {
  test("typed tag + pinned model-facing message", () => {
    const error = SubagentLimits.timeoutError({ timeout: 1500 })
    expect(error._tag).toBe("SubagentTimeoutError")
    expect(error.timeout).toBe(1500)
    expect(error.message).toBe(
      "Subagent task timed out after 1500ms and was aborted. The delegated work did not finish in time; do the remaining work directly in this session or retry with a larger timeout.",
    )
  })
})

// =============================================================================
// Foreground timeout fires promptly, aborts the subtree, parent terminates
// =============================================================================

it.instance(
  "a per-task timeout (tool param) aborts a hanging foreground child, fails typed, and the parent finishes",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(allowTaskCfg)
      const prompt = yield* SessionPrompt.Service
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "CEO" })

      // Root delegates with a short timeout; the child loop hangs forever.
      yield* llm.push(reply().tool("task", task("marker-l2 hang forever", { timeout: 1500 })))
      yield* llm.hang
      // After the task errors out the root gets one more turn to wrap up.
      yield* llm.push(reply().text("ROOT-RESULT").stop())
      yield* user(root.id, "marker-root start the chain")

      // The natural duration is "never" (the child hangs); the timeout must
      // make the whole loop settle well inside this window.
      const result = yield* awaitWithTimeout(
        prompt.loop({ sessionID: root.id }),
        "root loop never settled after the per-task timeout",
        "20 seconds",
      )
      expect(finalText(result)).toBe("ROOT-RESULT")

      // The subtree was aborted: the child's background job ends cancelled, no
      // orphan keeps running.
      const l2 = yield* pollWithTimeout(firstChild(root.id), "child session never appeared", "10 seconds")
      const l2Job = yield* pollWithTimeout(
        Effect.gen(function* () {
          const info = yield* jobs.get(l2.id)
          return info && info.status !== "running" ? info : undefined
        }),
        "child job never left running after the timeout",
        "10 seconds",
      )
      expect(l2Job.status).toBe("cancelled")

      // The typed timeout error surfaces in the parent's transcript.
      const error = yield* errorTaskMessage(root.id)
      expect(error).toContain("timed out after 1500ms")
    }),
  30_000,
)

it.instance(
  "an experimental.subagent_task_timeout config default aborts a hanging foreground child",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => ({
        ...allowTaskCfg(url),
        experimental: { subagent_task_timeout: 1500 },
      }))
      const prompt = yield* SessionPrompt.Service
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "CEO" })

      // No tool-param timeout: the config default must apply.
      yield* llm.push(reply().tool("task", task("marker-l2 hang forever")))
      yield* llm.hang
      yield* llm.push(reply().text("ROOT-RESULT").stop())
      yield* user(root.id, "marker-root start the chain")

      const result = yield* awaitWithTimeout(
        prompt.loop({ sessionID: root.id }),
        "root loop never settled after the config-default timeout",
        "20 seconds",
      )
      expect(finalText(result)).toBe("ROOT-RESULT")

      const l2 = yield* pollWithTimeout(firstChild(root.id), "child session never appeared", "10 seconds")
      const l2Job = yield* pollWithTimeout(
        Effect.gen(function* () {
          const info = yield* jobs.get(l2.id)
          return info && info.status !== "running" ? info : undefined
        }),
        "child job never left running after the config-default timeout",
        "10 seconds",
      )
      expect(l2Job.status).toBe("cancelled")
      expect(yield* errorTaskMessage(root.id)).toContain("timed out after 1500ms")
    }),
  30_000,
)

it.instance(
  "without a timeout the foreground task completes normally (unchanged behavior)",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(allowTaskCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "CEO" })

      yield* llm.push(
        reply().tool("task", task("marker-l2 do the share")),
        reply().text("L2-RESULT").stop(),
        reply().text("ROOT-RESULT").stop(),
      )
      yield* user(root.id, "marker-root start the chain")

      const result = yield* awaitWithTimeout(
        prompt.loop({ sessionID: root.id }),
        "untimed chain never completed",
        "20 seconds",
      )
      expect(finalText(result)).toBe("ROOT-RESULT")
      expect((yield* completedTaskOutput(root.id)).includes("L2-RESULT")).toBe(true)
    }),
  30_000,
)
