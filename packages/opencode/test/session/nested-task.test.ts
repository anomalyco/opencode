import { NodeFileSystem } from "@effect/platform-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable } from "@opencode-ai/core/session/sql"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { inArray } from "drizzle-orm"
import { FetchHttpClient } from "effect/unstable/http"
import { afterEach, expect } from "bun:test"
import { Effect, Fiber, Layer, Option } from "effect"
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
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SubagentLimits } from "@/session/subagent-limits"
import { Todo } from "@/session/todo"
import { TurnBudget } from "@/session/turn-budget"
import { Skill } from "@/skill"
import { Snapshot } from "@/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { TestInstance, disposeAllInstances } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer, reply } from "../lib/llm-server"

// T7 (plan.md): integration tests for nested subagent spawning. Every scenario
// drives the REAL prompt loop against a TestLLMServer instead of stubbed
// prompt ops — the request bodies on the mock are the ground truth for what
// each nesting level can see (tool list, depth hint) and the session/job/
// permission stores are the ground truth for the cascades.

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
    startAuth: () => Effect.die("unexpected MCP auth in nested-task tests"),
    authenticate: () => Effect.die("unexpected MCP auth in nested-task tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in nested-task tests"),
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

// Full SessionPrompt stack against the fake LLM (the prompt.test.ts harness),
// parameterized over runtime flags so the release-race scenario can switch on
// experimental background subagents for the task tool.
function makePrompt(flags?: Partial<RuntimeFlags.Info>) {
  const flagLayer = () => RuntimeFlags.layer({ experimentalEventSystem: true, ...flags })
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
const backgroundIt = testEffect(
  Layer.mergeAll(TestLLMServer.layer, makePrompt({ experimentalBackgroundSubagents: true })),
)

// Test provider registration pointed at the live TestLLMServer URL.
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

// Config-level `task: allow` keeps the multi-level chains ask-free: spawn
// capability below the depth limit rides the runtime merge of the agent
// permission (design-final §4.2) — child sessions do NOT inherit parent
// session allows, so a session-level allow would only cover the root.
function allowTaskCfg(url: string): Partial<ConfigV1.Info> {
  return { ...providerCfg(url), permission: { task: "allow" } }
}

const writeConfig = Effect.fn("NestedTaskTest.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("NestedTaskTest.useServerConfig")(function* (
  config: (url: string) => Partial<ConfigV1.Info>,
) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

const user = Effect.fn("NestedTaskTest.user")(function* (sessionID: SessionID, text: string) {
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

// ---- request-body helpers (the mock server records every request) ----------

type Hit = { url: URL; body: Record<string, unknown> }

const isTitle = (hit: Hit) => JSON.stringify(hit.body).includes("Generate a title for this conversation")

/**
 * The text of all USER messages in a request. The task prompt becomes the
 * child's user message and ONLY the child's (in the parent transcript the same
 * string only appears inside assistant tool-call arguments), so a unique
 * marker in the prompt identifies the requesting level unambiguously.
 */
function userTexts(hit: Hit): string {
  const messages = (hit.body.messages as { role?: string; content?: unknown }[] | undefined) ?? []
  return messages
    .filter((message) => message.role === "user")
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")))
    .join("\n")
}

const fromLevel = (marker: string) => (hit: Hit) => !isTitle(hit) && userTexts(hit).includes(marker)

function toolEntries(hit: Hit) {
  const tools = (hit.body.tools as { function?: { name?: string; description?: string } }[] | undefined) ?? []
  return tools
}

function toolNames(hit: Hit): string[] {
  return toolEntries(hit)
    .map((tool) => tool.function?.name)
    .filter((name): name is string => typeof name === "string")
}

function requestOf(hits: Hit[], marker: string): Hit {
  const hit = hits.find(fromLevel(marker))
  expect(hit).toBeDefined()
  return hit!
}

// ---- session/transcript helpers --------------------------------------------

const firstChild = Effect.fn("NestedTaskTest.firstChild")(function* (sessionID: SessionID) {
  const sessions = yield* Session.Service
  return (yield* sessions.children(sessionID))[0]
})

/** Polls until `levels` generations exist below the root; returns them top-down. */
const awaitChain = (rootID: SessionID, levels: number) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const chain: Session.Info[] = []
      let current = rootID
      for (let i = 0; i < levels; i++) {
        const kid = yield* firstChild(current)
        if (!kid) return undefined
        chain.push(kid)
        current = kid.id
      }
      return chain
    }),
    `chain of ${levels} child sessions never appeared`,
    "15 seconds",
  )

const taskParts = Effect.fn("NestedTaskTest.taskParts")(function* (sessionID: SessionID) {
  const msgs = yield* MessageV2.filterCompactedEffect(sessionID)
  return msgs.flatMap((msg) =>
    msg.parts.filter((part): part is SessionV1.ToolPart => part.type === "tool" && part.tool === "task"),
  )
})

const completedTaskOutput = Effect.fn("NestedTaskTest.completedTaskOutput")(function* (sessionID: SessionID) {
  const parts = yield* taskParts(sessionID)
  const completed = parts.find((part) => part.state.status === "completed")
  expect(completed?.state.status).toBe("completed")
  return completed?.state.status === "completed" ? completed.state.output : ""
})

const errorTaskMessage = Effect.fn("NestedTaskTest.errorTaskMessage")(function* (sessionID: SessionID) {
  const parts = yield* taskParts(sessionID)
  const failed = parts.find((part) => part.state.status === "error")
  expect(failed?.state.status).toBe("error")
  return failed?.state.status === "error" ? failed.state.error : ""
})

const finalText = (result: SessionV1.WithParts) => result.parts.findLast((part) => part.type === "text")?.text ?? ""

const waitIdle = (sessionID: SessionID) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const svc = yield* SessionStatus.Service
      return (yield* svc.get(sessionID)).type === "idle" ? (true as const) : undefined
    }),
    `session ${sessionID} never became idle`,
    "10 seconds",
  )

const waitBusy = (sessionID: SessionID) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const svc = yield* SessionStatus.Service
      return (yield* svc.get(sessionID)).type === "busy" ? (true as const) : undefined
    }),
    `session ${sessionID} never became busy`,
    "10 seconds",
  )

// =============================================================================
// T7.1 happy path + per-level tool list
// =============================================================================

it.instance(
  "T7.1 five-level chain bubbles results up; levels 1-4 see the task tool, level 5 does not",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(allowTaskCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "CEO" })

      // Strictly sequential foreground chain: every parent loop blocks on its
      // task tool, so the ordered queue maps 1:1 onto the request order.
      yield* llm.push(
        reply().tool("task", task("marker-l2 do the L2 share")),
        reply().tool("task", task("marker-l3 do the L3 share")),
        reply().tool("task", task("marker-l4 do the L4 share")),
        reply().tool("task", task("marker-l5 do the L5 share")),
        reply().text("L5-RESULT").stop(),
        reply().text("L4-RESULT").stop(),
        reply().text("L3-RESULT").stop(),
        reply().text("L2-RESULT").stop(),
        reply().text("ROOT-RESULT").stop(),
      )
      yield* user(root.id, "marker-root start the chain")

      const result = yield* awaitWithTimeout(
        prompt.loop({ sessionID: root.id }),
        "five-level chain never completed",
        "40 seconds",
      )
      expect(finalText(result)).toBe("ROOT-RESULT")

      // Result propagation: every hop's completed task part carries its
      // child's final text wrapped in the <task> envelope.
      const [l2, l3, l4, l5] = yield* awaitChain(root.id, 4)
      expect((yield* completedTaskOutput(root.id)).includes("L2-RESULT")).toBe(true)
      expect(yield* completedTaskOutput(root.id)).toContain(`<task id="${l2.id}" state="completed">`)
      expect((yield* completedTaskOutput(l2.id)).includes("L3-RESULT")).toBe(true)
      expect((yield* completedTaskOutput(l3.id)).includes("L4-RESULT")).toBe(true)
      expect((yield* completedTaskOutput(l4.id)).includes("L5-RESULT")).toBe(true)
      expect(yield* sessions.children(l5.id)).toHaveLength(0)

      // Request-body assertions on the mock: levels 1-4 get the task tool,
      // level 5 (= maxDepth) does NOT.
      const hits = (yield* llm.hits) as Hit[]
      const rootHit = requestOf(hits, "marker-root")
      const l2Hit = requestOf(hits, "marker-l2")
      const l3Hit = requestOf(hits, "marker-l3")
      const l4Hit = requestOf(hits, "marker-l4")
      const l5Hit = requestOf(hits, "marker-l5")

      for (const hit of [rootHit, l2Hit, l3Hit, l4Hit]) {
        expect(toolNames(hit)).toContain("task")
      }
      expect(toolNames(l5Hit)).not.toContain("task")
      // ...but level 5 is still a full work level (only delegation is gone).
      expect(toolNames(l5Hit)).toContain("read")

      // Ü5: mid-levels are told their delegation budget; the root description
      // stays hint-free (byte-identical to the pre-nesting behavior).
      const taskDescription = (hit: Hit) =>
        toolEntries(hit).find((tool) => tool.function?.name === "task")?.function?.description ?? ""
      expect(taskDescription(rootHit)).not.toContain("delegation depth")
      expect(taskDescription(l2Hit)).toContain("delegation depth 2 of 5")
      expect(taskDescription(l3Hit)).toContain("delegation depth 3 of 5")
      expect(taskDescription(l4Hit)).toContain("delegation depth 4 of 5")
    }),
  60_000,
)

// =============================================================================
// T7.2 abort cascade over 4 levels
// =============================================================================

it.instance(
  "T7.2 cancelling the root cascades through 4 hanging levels: all runners idle, all jobs cancelled",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(allowTaskCfg)
      const prompt = yield* SessionPrompt.Service
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "CEO" })

      yield* llm.push(
        reply().tool("task", task("marker-l2 dig deeper")),
        reply().tool("task", task("marker-l3 dig deeper")),
        reply().tool("task", task("marker-l4 dig deeper")),
      )
      yield* llm.hang // L4's reply never finishes
      yield* user(root.id, "marker-root start digging")

      const fiber = yield* prompt.loop({ sessionID: root.id }).pipe(Effect.forkChild)

      const [l2, l3, l4] = yield* awaitChain(root.id, 3)
      yield* waitBusy(l4.id)

      yield* prompt.cancel(root.id)
      yield* awaitWithTimeout(Fiber.await(fiber), "root loop never settled after cancel", "15 seconds")

      for (const session of [root, l2, l3, l4]) {
        yield* waitIdle(session.id)
      }
      for (const session of [l2, l3, l4]) {
        const job = yield* pollWithTimeout(
          Effect.gen(function* () {
            const info = yield* jobs.get(session.id)
            return info && info.status !== "running" ? info : undefined
          }),
          `job ${session.id} never left running`,
          "10 seconds",
        )
        expect(job.status).toBe("cancelled")
      }
    }),
  45_000,
)

// =============================================================================
// T7.3 release-race regression (Ü1): completed mid-job, running grandchild
// =============================================================================

backgroundIt.instance(
  "T7.3 root cancel reaches a running grandchild job across a completed mid-level background job",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(allowTaskCfg)
      const prompt = yield* SessionPrompt.Service
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "CEO" })

      // Background spawns decouple the levels, so the mid-level job COMPLETES
      // while its child keeps running — the release race. Matchers route the
      // replies because root and L2 run concurrently; the injected
      // "Background task completed" notification turn is auto-answered. (The
      // root's regular continuation request contains "Background task
      // started" from the tool output and must still match.)
      yield* llm.pushMatch(
        (hit) =>
          fromLevel("marker-root")(hit as Hit) && !JSON.stringify(hit.body).includes("Background task completed"),
        reply().tool("task", task("marker-l2 run in background", { background: true })),
        reply().text("ROOT-RESULT").stop(),
      )
      yield* llm.pushMatch(
        fromLevel("marker-l2"),
        reply().tool("task", task("marker-l3 run deeper in background", { background: true })),
        reply().text("L2-RESULT").stop(),
      )
      yield* llm.pushMatch(fromLevel("marker-l3"), reply().hang())
      yield* user(root.id, "marker-root kick off background work")

      const result = yield* awaitWithTimeout(
        prompt.loop({ sessionID: root.id }),
        "root loop never completed",
        "20 seconds",
      )
      expect(finalText(result)).toBe("ROOT-RESULT")

      const [l2, l3] = yield* awaitChain(root.id, 2)

      // The race precondition: mid-level job completed, grandchild running.
      const l2Job = yield* pollWithTimeout(
        Effect.gen(function* () {
          const info = yield* jobs.get(l2.id)
          return info?.status === "completed" ? info : undefined
        }),
        "mid-level background job never completed",
        "15 seconds",
      )
      expect(l2Job.status).toBe("completed")
      yield* waitBusy(l3.id)
      expect((yield* jobs.get(l3.id))?.status).toBe("running")

      // Root-level cancel WITHOUT the descendants seed (SessionRunState
      // directly): the metadata bridge over the completed L2 job record plus
      // the rootSessionId stamp must reach the grandchild on their own.
      yield* runState.cancel(root.id)

      const l3Job = yield* pollWithTimeout(
        Effect.gen(function* () {
          const info = yield* jobs.get(l3.id)
          return info && info.status !== "running" ? info : undefined
        }),
        "grandchild job survived the root cancel",
        "10 seconds",
      )
      expect(l3Job.status).toBe("cancelled")
      // Completed jobs are bridges, never cancel targets.
      expect((yield* jobs.get(l2.id))?.status).toBe("completed")
    }),
  45_000,
)

// =============================================================================
// T7.4 deadlock regression: task_id pointing at an ancestor
// =============================================================================

it.instance(
  "T7.4 a level-3 task_id resume of the root fails typed in the transcript instead of hanging",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(allowTaskCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "CEO" })

      yield* llm.push(
        reply().tool("task", task("marker-l2 delegate further")),
        reply().tool("task", task("marker-l3 attempt the resume")),
        // L3 tries to resume its grand-ancestor — the pre-fix behavior was a
        // silent adoption that deadlocked (child waiting on its own ancestor).
        reply().tool("task", task("resume the root session", { task_id: root.id })),
        reply().text("L3-RESULT").stop(),
        reply().text("L2-RESULT").stop(),
        reply().text("ROOT-RESULT").stop(),
      )
      yield* user(root.id, "marker-root start")

      const result = yield* awaitWithTimeout(
        prompt.loop({ sessionID: root.id }),
        "loop hung on the ancestor resume (deadlock regression)",
        "30 seconds",
      )
      expect(finalText(result)).toBe("ROOT-RESULT")

      const [l2, l3] = yield* awaitChain(root.id, 2)
      // The typed SubagentResumeError surfaces as the task tool's error output
      // in L3's transcript.
      const error = yield* errorTaskMessage(l3.id)
      expect(error).toContain(`Cannot resume task ${root.id}`)
      // No session was adopted or created by the refused resume.
      expect(yield* sessions.children(l3.id)).toHaveLength(0)
      expect(yield* sessions.children(root.id)).toHaveLength(1)
      expect(yield* sessions.children(l2.id)).toHaveLength(1)
    }),
  45_000,
)

// =============================================================================
// T7.5 permission ask routing to the root + headless filter
// =============================================================================

it.instance(
  "T7.5 a permission ask from level 3 lands on the ROOT session with origin metadata and is answerable",
  () =>
    Effect.gen(function* () {
      // `task: ask` in the user config overrides the agents' default
      // `'*': allow` wildcard, so every task spawn asks. The root session gets
      // a session-level allow (last-match-wins over the agent ruleset) so only
      // the SUBAGENT levels ask — session allows are not inherited, so L2/L3
      // still go through the ask.
      const { llm } = yield* useServerConfig((url) => ({
        ...providerCfg(url),
        permission: { task: "ask" },
      }))
      const prompt = yield* SessionPrompt.Service
      const permission = yield* Permission.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({
        title: "CEO",
        permission: [{ permission: "task", pattern: "*", action: "allow" }],
      })

      yield* llm.push(
        reply().tool("task", task("marker-l2 delegate")),
        reply().tool("task", task("marker-l3 delegate")),
        reply().tool("task", task("marker-l4 work")),
        reply().text("L4-RESULT").stop(),
        reply().text("L3-RESULT").stop(),
        reply().text("L2-RESULT").stop(),
        reply().text("ROOT-RESULT").stop(),
      )
      yield* user(root.id, "marker-root start")

      const fiber = yield* prompt.loop({ sessionID: root.id }).pipe(Effect.forkChild)

      // Ask #1: L2 (depth 2) spawning L3.
      const first = yield* pollWithTimeout(
        permission.list().pipe(Effect.map((requests) => requests[0])),
        "ask from level 2 never arrived",
        "15 seconds",
      )
      expect(first.sessionID).toBe(root.id)
      expect(first.permission).toBe("task")
      const l2 = (yield* awaitChain(root.id, 1))[0]
      expect(first.metadata?.["originSessionID"]).toBe(l2.id)
      expect(first.metadata?.["originAgent"]).toBe("general")
      expect(first.metadata?.["originDepth"]).toBe(2)
      yield* permission.reply({ requestID: first.id, reply: "once" })

      // Ask #2: L3 (depth 3) spawning L4 — the scenario's assertion target.
      const second = yield* pollWithTimeout(
        permission
          .list()
          .pipe(Effect.map((requests) => requests.find((request) => request.metadata?.["originDepth"] === 3))),
        "ask from level 3 never arrived",
        "15 seconds",
      )
      const l3 = yield* pollWithTimeout(firstChild(l2.id), "level-3 session never appeared", "10 seconds")
      expect(second.sessionID).toBe(root.id)
      expect(second.metadata?.["originSessionID"]).toBe(l3.id)
      expect(second.metadata?.["originAgent"]).toBe("general")
      expect(second.metadata?.["originDepth"]).toBe(3)

      // Headless regression (run.ts permission filter): `opencode run` drives
      // the root session and skips events with `permission.sessionID !==
      // sessionID`. Root routing makes the depth-3 ask pass that filter — the
      // exact predicate run.ts applies, then the same reply it would send.
      expect(second.sessionID !== root.id).toBe(false)
      yield* permission.reply({ requestID: second.id, reply: "once" })

      const result = yield* awaitWithTimeout(
        Fiber.join(fiber),
        "loop never completed after the asks were answered",
        "20 seconds",
      )
      expect(finalText(result)).toBe("ROOT-RESULT")
    }),
  60_000,
)

// =============================================================================
// T7.6 turn budget end-to-end
// =============================================================================
//
// NOTE: the companion case "T7.6a" (the root turn's pool COMMITS the child's
// spend) is omitted here — it asserts the main-loop processor charging
// (TurnBudget.chargeDirect via the processor), which lives in a processor.ts
// change that is out of scope for this branch. The pool's spawn-gating
// behavior (reserve/refuse) IS in scope and is covered by T7.6b below.

it.instance(
  "T7.6b an exhausted pool refuses the spawn with the typed budget error and creates no session",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(allowTaskCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "CEO" })
      const pool = TurnBudget.make({ tokens: 5 })
      TurnBudget.chargeDirect(pool, { usd: 0, tokens: 5 })

      yield* llm.push(
        reply().tool("task", task("marker-l2 should never start")),
        reply().text("ROOT-RESULT").stop(),
      )
      yield* user(root.id, "marker-root start")

      const result = yield* awaitWithTimeout(
        prompt.loop({ sessionID: root.id, turnBudget: pool }),
        "loop with exhausted pool never completed",
        "20 seconds",
      )
      // Soft cap: the root turn itself keeps running (chargeDirect is never
      // gated); only the SPAWN is refused, as a tool error in the transcript.
      expect(finalText(result)).toBe("ROOT-RESULT")
      expect(yield* errorTaskMessage(root.id)).toContain("Turn budget exhausted")
      expect(yield* sessions.children(root.id)).toHaveLength(0)
    }),
  30_000,
)

// =============================================================================
// T7.7 cleanup: removing the root clears the whole tree
// =============================================================================

it.instance(
  "T7.7 sessions.remove(root) clears a loop-built 3-level tree including all messages",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(allowTaskCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const { db } = yield* Database.Service
      const root = yield* sessions.create({ title: "CEO" })

      yield* llm.push(
        reply().tool("task", task("marker-l2 delegate")),
        reply().tool("task", task("marker-l3 work")),
        reply().text("L3-RESULT").stop(),
        reply().text("L2-RESULT").stop(),
        reply().text("ROOT-RESULT").stop(),
      )
      yield* user(root.id, "marker-root start")
      yield* awaitWithTimeout(prompt.loop({ sessionID: root.id }), "three-level chain never completed", "30 seconds")

      const [l2, l3] = yield* awaitChain(root.id, 2)
      const ids = [root.id, l2.id, l3.id]
      const before = yield* db.select().from(MessageTable).where(inArray(MessageTable.session_id, ids)).all()
      expect(before.length).toBeGreaterThan(0)

      yield* sessions.remove(root.id)

      for (const id of ids) {
        expect(Option.isNone(yield* sessions.get(id).pipe(Effect.option))).toBe(true)
      }
      const after = yield* db.select().from(MessageTable).where(inArray(MessageTable.session_id, ids)).all()
      expect(after.length).toBe(0)
    }),
  45_000,
)

// =============================================================================
// T7.8 tree lifetime cap end-to-end (seam = 3)
// =============================================================================

it.instance(
  "T7.8 with the tree cap seam at 3 the fourth spawn in the tree fails typed in the transcript",
  () =>
    Effect.gen(function* () {
      SubagentLimits.__testHooks.treeLimit = 3
      const { llm } = yield* useServerConfig(allowTaskCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "CEO" })

      // Four sequential spawn attempts from the root: 1-3 pass the cap, the
      // fourth fails the gate before any session is created.
      yield* llm.push(
        reply().tool("task", task("marker-a first delegation")),
        reply().text("A-RESULT").stop(),
        reply().tool("task", task("marker-b second delegation")),
        reply().text("B-RESULT").stop(),
        reply().tool("task", task("marker-c third delegation")),
        reply().text("C-RESULT").stop(),
        reply().tool("task", task("marker-d fourth delegation")),
        reply().text("ROOT-RESULT").stop(),
      )
      yield* user(root.id, "marker-root delegate four times")

      const result = yield* awaitWithTimeout(
        prompt.loop({ sessionID: root.id }),
        "tree-cap chain never completed",
        "30 seconds",
      )
      expect(finalText(result)).toBe("ROOT-RESULT")

      expect(yield* sessions.children(root.id)).toHaveLength(3)
      const error = yield* errorTaskMessage(root.id)
      expect(error).toContain("Subagent limit reached")
      expect(error).toContain("3 of 3")
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          SubagentLimits.__testHooks.treeLimit = undefined
        }),
      ),
    ),
  45_000,
)

// =============================================================================
// T7.9 config semantics (Ü7)
// =============================================================================

it.instance(
  "T7.9a subagent_max_depth=2 reproduces the legacy behavior: the child has no task tool and carries the denies",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => ({
        ...allowTaskCfg(url),
        experimental: { subagent_max_depth: 2 },
      }))
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "CEO" })

      yield* llm.push(
        reply().tool("task", task("marker-l2 child work")),
        reply().text("L2-RESULT").stop(),
        reply().text("ROOT-RESULT").stop(),
      )
      yield* user(root.id, "marker-root start")

      const result = yield* awaitWithTimeout(
        prompt.loop({ sessionID: root.id }),
        "legacy-mode chain never completed",
        "20 seconds",
      )
      expect(finalText(result)).toBe("ROOT-RESULT")

      // Root still spawns (depth 1 < 2)...
      const [l2] = yield* awaitChain(root.id, 1)
      // ...but the child is the last level: the legacy auto-denies are
      // persisted on its session ruleset (same mechanism as pre-nesting)...
      expect(l2.permission).toEqual(
        expect.arrayContaining([{ permission: "task", pattern: "*", action: "deny" }]),
      )
      // ...and its LLM request carries no task tool.
      const hits = (yield* llm.hits) as Hit[]
      const rootHit = requestOf(hits, "marker-root")
      const l2Hit = requestOf(hits, "marker-l2")
      expect(toolNames(rootHit)).toContain("task")
      expect(toolNames(l2Hit)).not.toContain("task")
      expect(toolNames(l2Hit)).toContain("read")
    }),
  30_000,
)

it.instance(
  "T7.9b subagent_max_depth=1 is the kill switch: even the root request has no task tool",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => ({
        ...allowTaskCfg(url),
        experimental: { subagent_max_depth: 1 },
      }))
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "CEO" })

      yield* llm.push(reply().text("ROOT-RESULT").stop())
      yield* user(root.id, "marker-root just answer")

      const result = yield* awaitWithTimeout(
        prompt.loop({ sessionID: root.id }),
        "kill-switch loop never completed",
        "15 seconds",
      )
      expect(finalText(result)).toBe("ROOT-RESULT")

      const hits = (yield* llm.hits) as Hit[]
      const rootHit = requestOf(hits, "marker-root")
      expect(toolNames(rootHit)).not.toContain("task")
      expect(toolNames(rootHit)).toContain("read")
    }),
  20_000,
)
