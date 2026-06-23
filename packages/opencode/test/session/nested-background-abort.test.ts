import { NodeFileSystem } from "@effect/platform-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { FetchHttpClient } from "effect/unstable/http"
import { afterEach, describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
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
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Todo } from "@/session/todo"
import { Skill } from "@/skill"
import { Snapshot } from "@/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { TestInstance, disposeAllInstances } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer, reply } from "../lib/llm-server"

// Issue 9 (followups): the abort cascade is exercised for pure-foreground
// chains (nested-task.test.ts T7.2) and a pure-background release race (T7.3),
// but the MIX — a parent with background AND foreground children live at once,
// spread across levels — is not. This drives that mix through the REAL prompt
// loop with OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS on, aborts the parent,
// and verifies every child of both modes terminates with no orphaned
// background job. The release-race fix (commit 5582da5a8: rootSessionId job
// metadata + the session tree as a second cancel source) must stay closed, and
// cancel must never block on a permit/budget slot (design-final §10 / Issue 1).

afterEach(async () => {
  await disposeAllInstances()
})

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
    startAuth: () => Effect.die("unexpected MCP auth in nested-background-abort tests"),
    authenticate: () => Effect.die("unexpected MCP auth in nested-background-abort tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in nested-background-abort tests"),
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

// Full SessionPrompt stack against the fake LLM with experimental background
// subagents on, so the task tool accepts background spawns (mirrors the
// backgroundIt harness in nested-task.test.ts).
function makePrompt() {
  const flagLayer = () =>
    RuntimeFlags.layer({ experimentalEventSystem: true, experimentalBackgroundSubagents: true })
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
  const compact = SessionCompaction.layer.pipe(Layer.provide(flagLayer()), Layer.provideMerge(proc), Layer.provideMerge(deps))
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
        options: { apiKey: "test-key", baseURL: url },
      },
    },
  }
}

// `task: allow` keeps the multi-level chains ask-free so cancel never races a
// pending permission ask — exactly the property under test (abort must never
// wait on a permit, design-final §10).
function allowTaskCfg(url: string): Partial<ConfigV1.Info> {
  return { ...providerCfg(url), permission: { task: "allow" } }
}

const writeConfig = Effect.fn("NestedBgAbortTest.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("NestedBgAbortTest.useServerConfig")(function* (
  config: (url: string) => Partial<ConfigV1.Info>,
) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

const user = Effect.fn("NestedBgAbortTest.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
    time: { created: Date.now() },
  })
  yield* session.updatePart({ id: PartID.ascending(), messageID: msg.id, sessionID, type: "text", text })
  return msg
})

function task(prompt: string, extra?: Record<string, unknown>) {
  return { description: "delegate work", prompt, subagent_type: "general", ...extra }
}

type Hit = { url: URL; body: Record<string, unknown> }

const isTitle = (hit: Hit) => JSON.stringify(hit.body).includes("Generate a title for this conversation")

function userTexts(hit: Hit): string {
  const messages = (hit.body.messages as { role?: string; content?: unknown }[] | undefined) ?? []
  return messages
    .filter((message) => message.role === "user")
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")))
    .join("\n")
}

const fromLevel = (marker: string) => (hit: Hit) => !isTitle(hit) && userTexts(hit).includes(marker)

const firstChild = Effect.fn("NestedBgAbortTest.firstChild")(function* (sessionID: SessionID) {
  const sessions = yield* Session.Service
  return (yield* sessions.children(sessionID))[0]
})

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

const waitJobSettled = (sessionID: SessionID) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const info = yield* jobs.get(sessionID)
      return info && info.status !== "running" ? info : undefined
    }),
    `job ${sessionID} never left running`,
    "10 seconds",
  )

const waitJobRunning = (sessionID: SessionID) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const info = yield* jobs.get(sessionID)
      return info?.status === "running" ? info : undefined
    }),
    `job ${sessionID} never reached running`,
    "10 seconds",
  )

describe("session.nested-background-abort", () => {
  // ===========================================================================
  // A parent with a foreground child (L2) that itself launches a BACKGROUND
  // grandchild (L3), which in turn runs a FOREGROUND great-grandchild (L4):
  // both modes are live across levels under one parent. Cancelling the root
  // must terminate every level and cancel the background job — no orphans.
  // ===========================================================================
  it.instance(
    "cancelling the root terminates a mixed foreground/background subtree across 4 levels with no orphaned jobs",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(allowTaskCfg)
        const prompt = yield* SessionPrompt.Service
        const jobs = yield* BackgroundJob.Service
        const sessions = yield* Session.Service
        const root = yield* sessions.create({ title: "CEO" })

        // Matchers route per level because the background spawn decouples the
        // levels (root + L2 run concurrently once L3 is detached). L4 hangs.
        yield* llm.pushMatch(fromLevel("marker-root"), reply().tool("task", task("marker-l2 foreground dig")))
        yield* llm.pushMatch(
          (hit) =>
            fromLevel("marker-l2")(hit as Hit) && !JSON.stringify(hit.body).includes("Background task started"),
          reply().tool("task", task("marker-l3 background dig", { background: true })),
          reply().text("L2-RESULT").stop(),
        )
        yield* llm.pushMatch(fromLevel("marker-l3"), reply().tool("task", task("marker-l4 foreground dig")))
        yield* llm.pushMatch(fromLevel("marker-l4"), reply().hang())
        yield* user(root.id, "marker-root start the mixed subtree")

        const fiber = yield* prompt.loop({ sessionID: root.id }).pipe(Effect.forkChild)

        const [l2, l3, l4] = yield* awaitChain(root.id, 3)
        // Preconditions: the background grandchild's job is running and the
        // foreground great-grandchild is busy on the hanging reply.
        yield* waitJobRunning(l3.id)
        yield* waitBusy(l4.id)

        // Cancel the root. The release-race fix (rootSessionId metadata + the
        // session tree as a second cancel source) must reach the background
        // grandchild even though L2 may complete its foreground turn.
        yield* prompt.cancel(root.id)
        yield* awaitWithTimeout(Fiber.await(fiber), "root loop never settled after cancel", "15 seconds")

        // Every level — foreground and background alike — drains to idle.
        for (const session of [root, l2, l3, l4]) {
          yield* waitIdle(session.id)
        }
        // The background grandchild's job is cancelled, not left orphaned.
        const l3Job = yield* waitJobSettled(l3.id)
        expect(l3Job.status).toBe("cancelled")
        // No background job anywhere in the tree survives in `running`.
        const live = yield* jobs.list()
        const treeIDs = new Set([root.id, l2.id, l3.id, l4.id])
        expect(
          live.filter((job) => job.status === "running" && typeof job.metadata?.sessionId === "string" && treeIDs.has(job.metadata.sessionId as SessionID)),
        ).toHaveLength(0)
      }),
    60_000,
  )

  // ===========================================================================
  // Sibling fan-out under one parent: a foreground child and a background
  // child run at the SAME time directly below the root. The root cancel must
  // tear down both, and must not block waiting on the foreground child's
  // hanging turn (abort never waits on a permit/budget slot).
  // ===========================================================================
  it.instance(
    "cancelling the root tears down a concurrent foreground + background sibling pair without blocking on the foreground hang",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(allowTaskCfg)
        const prompt = yield* SessionPrompt.Service
        const jobs = yield* BackgroundJob.Service
        const sessions = yield* Session.Service
        const root = yield* sessions.create({ title: "CEO" })

        // The root launches a background sibling first (decoupling its own
        // turn), then — on its continuation request, which now carries the
        // "Background task started" tool output — a foreground sibling that
        // hangs. Both are live when the cancel arrives. The two root requests
        // are disambiguated by that injected marker so the order is fixed.
        yield* llm.pushMatch(
          (hit) =>
            fromLevel("marker-root")(hit as Hit) && !JSON.stringify(hit.body).includes("Background task started"),
          reply().tool("task", task("marker-bg background sibling", { background: true })),
        )
        yield* llm.pushMatch(
          (hit) => fromLevel("marker-root")(hit as Hit) && JSON.stringify(hit.body).includes("Background task started"),
          reply().tool("task", task("marker-fg foreground sibling")),
        )
        yield* llm.pushMatch(fromLevel("marker-bg"), reply().hang())
        yield* llm.pushMatch(fromLevel("marker-fg"), reply().hang())
        yield* user(root.id, "marker-root fan out two siblings")

        const fiber = yield* prompt.loop({ sessionID: root.id }).pipe(Effect.forkChild)

        // Wait for BOTH siblings to exist and be live.
        const sibs = yield* pollWithTimeout(
          Effect.gen(function* () {
            const kids = yield* sessions.children(root.id)
            return kids.length >= 2 ? kids : undefined
          }),
          "both sibling sessions never appeared",
          "15 seconds",
        )
        const bg = yield* pollWithTimeout(
          Effect.gen(function* () {
            for (const kid of sibs) {
              const info = yield* jobs.get(kid.id)
              if (info?.status === "running" && info.metadata?.background === true) return kid
            }
            return undefined
          }),
          "background sibling job never reached running",
          "15 seconds",
        )
        const fg = sibs.find((kid) => kid.id !== bg.id)!
        yield* waitBusy(fg.id)

        // Cancel must settle promptly even though the foreground sibling's
        // reply hangs forever — it never awaits a permit/budget slot.
        yield* prompt.cancel(root.id)
        yield* awaitWithTimeout(Fiber.await(fiber), "root loop never settled after cancel", "15 seconds")

        for (const session of [root, bg, fg]) {
          yield* waitIdle(session.id)
        }
        const bgJob = yield* waitJobSettled(bg.id)
        expect(bgJob.status).toBe("cancelled")
        const live = yield* jobs.list()
        const treeIDs = new Set([root.id, bg.id, fg.id])
        expect(
          live.filter((job) => job.status === "running" && typeof job.metadata?.sessionId === "string" && treeIDs.has(job.metadata.sessionId as SessionID)),
        ).toHaveLength(0)
      }),
    60_000,
  )
})
