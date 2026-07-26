// Session-to-Session — C′ wake-poller reproduction (systematic-debugging Phase 4).
//
// The LIVE failure: a cross-process s2s message persists to s2s_inbox but the
// recipient's C′ wake-poller never claims it (drained_at stays NULL). The
// existing wakeup-spike test only exercises the D-drain (it calls
// `prompt.loop` AFTER enqueue), and sets experimentalAgentMessaging — NOT
// experimentalS2S. The C′ fork (gated on experimentalS2S, forked inside
// SessionPrompt.loop) has ZERO coverage.
//
// This test reproduces the real production path:
//   (1) experimentalS2S: true
//   (2) call prompt.loop ONCE → this is the only thing that forks the C′ poller
//   (3) insert a row DIRECTLY into s2s_inbox via the store (simulating the
//       cross-process sender — NOT messaging.enqueue, which is in-process)
//   (4) DO NOT call loop again — the forked C′ poller must claim it on its own
//   (5) assert the row's drained_at is set within a few poll intervals
//
// The S2S-DIAG logs in prompt.ts / poller.ts / wake-registry.ts will show
// exactly where the pipeline breaks.
//
// Importing the poller module is REQUIRED: in production app-runtime.ts imports
// S2SPoller, whose module top-level runs registerWakeBody(wakePollerLoop). The
// wakeBody() the C′ fork calls is a no-op stub until that registration runs.
import "@/s2s/poller"

import { afterAll, afterEach, beforeAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { Env } from "../../src/env"
import { EventV2Bridge } from "@/event-v2-bridge"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Format } from "../../src/format"
import { Git } from "../../src/git"
import { Image } from "@/image/image"
import { Instruction } from "@/session/instruction"
import { Interrupt } from "@/session/interrupt"
import { LLM } from "@/session/llm"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Messaging } from "../../src/messaging"
import { ModelV2 } from "@opencode-ai/core/model"
import { Permission } from "@/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Question } from "@/question"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Session } from "@/session/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionCompaction } from "@/session/compaction"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { S2SStore } from "../../src/s2s/store"
import { Skill } from "../../src/skill"
import { Snapshot } from "@/snapshot"
import { SystemPrompt } from "@/session/system"
import { Todo } from "@/session/todo"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { SessionID } from "../../src/session/schema"
import { TestInstance, disposeAllInstances } from "../fixture/fixture"
import { testEffectIsolatedShared } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

afterEach(async () => {
  await disposeAllInstances()
})

// The C′ poller forked inside SessionPrompt.loop reads OPENCODE_S2S_POLL_MS at
// fork time (prompt.ts). Sibling test files (lifecycle.test.ts, poller.test.ts)
// assign that env var at MODULE-EVAL time to "60000"; in a full `test/s2s` run
// those top-level assignments leak into this process, so this file's poller
// would poll every 60s and the wait-loops below would time out. Pin a small
// interval here (clamped to the prod floor of 250ms) for the duration of THIS
// file and restore the prior value afterward so we don't leak forward either.
let prevPollMs: string | undefined
beforeAll(() => {
  prevPollMs = process.env["OPENCODE_S2S_POLL_MS"]
  process.env["OPENCODE_S2S_POLL_MS"] = "250"
})
afterAll(() => {
  if (prevPollMs === undefined) delete process.env["OPENCODE_S2S_POLL_MS"]
  else process.env["OPENCODE_S2S_POLL_MS"] = prevPollMs
})

const summaryStub = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const mcpStub = Layer.succeed(
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
    startAuth: () => Effect.die("unexpected MCP auth in cprime-fork test"),
    authenticate: () => Effect.die("unexpected MCP auth in cprime-fork test"),
    finishAuth: () => Effect.die("unexpected MCP auth in cprime-fork test"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    instructions: () => Effect.succeed([]),
    resourceTemplates: () => Effect.succeed({}),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lspStub = Layer.succeed(
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

const statusNode = LayerNode.make({ service: SessionStatus.Service, layer: SessionStatus.layer, deps: [EventV2Bridge.node] })
const runStateNode = LayerNode.make({ service: SessionRunState.Service, layer: SessionRunState.layer, deps: [BackgroundJob.node, statusNode] })

// experimentalS2S: true is the load-bearing difference from wakeup-spike — it
// gates the C′ fork in SessionPrompt.loop.
const s2sFlags = RuntimeFlags.layer({
  experimentalEventSystem: true,
  experimentalAgentMessaging: true,
  experimentalS2S: true,
})

const providerCfgFor = (url: string): Partial<ConfigV1.Info> => ({
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
          tool_call: false,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: url },
    },
  },
})

function makeRunLoopLayer() {
  const root = LayerNode.group([
    Session.node,
    SessionProjector.node,
    Snapshot.node,
    LLM.node,
    Env.node,
    Agent.node,
    Command.node,
    Permission.node,
    Plugin.node,
    Config.node,
    Provider.node,
    FSUtil.node,
    BackgroundJob.node,
    Database.node,
    EventV2Bridge.node,
    Interrupt.node,
    S2SStore.node,
    Messaging.node,
    Todo.node,
    Question.node,
    ToolRegistry.node,
    Skill.node,
    CrossSpawnSpawner.node,
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
    SessionPrompt.node,
    statusNode,
    runStateNode,
  ])
  const replacements: LayerNode.Replacements = [
    [SessionSummary.node, summaryStub],
    [LSP.node, lspStub],
    [MCP.node, mcpStub],
    [RuntimeFlags.node, s2sFlags],
    [SessionStatus.node, statusNode],
    [SessionRunState.node, runStateNode],
  ]
  return LayerNode.compile(root, replacements)
}

const reproLayer = Layer.mergeAll(TestLLMServer.layer, makeRunLoopLayer())
const it = testEffectIsolatedShared(reproLayer as unknown as Layer.Layer<any, any, never>)

const writeConfig = Effect.fn("CprimeFork.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("CprimeFork.useServerConfig")(function* (
  config: (url: string) => Partial<ConfigV1.Info>,
) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

describe("s2s C′ wake-poller: forked-from-loop claims a DB row on an idle session", () => {
  it.instance(
    "after one loop, an inserted s2s_inbox row is claimed by the C′ poller WITHOUT a second loop",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfgFor)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const store = yield* S2SStore.Service

        const chat = yield* sessions.create({
          title: "C-prime fork repro",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // Seed a committed user+assistant turn so the session is IDLE with a
        // lastUser. prompt.prompt internally calls loop → which (with
        // experimentalS2S) forks the C′ poller.
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "warm-up" }],
        })
        yield* llm.text("warm-up-reply")

        // Trigger the C′ fork explicitly via loop (idempotent; mirrors a real
        // turn). After this returns, a wake-poller fiber should be alive.
        yield* prompt.loop({ sessionID: chat.id })

        // Simulate the CROSS-PROCESS sender: write a row straight into
        // s2s_inbox via the store, exactly as enqueueExternal does in another
        // process. NOT messaging.enqueue (that's the in-process inbox).
        yield* store.insertInbox({
          id: "01999999-aaaa-7000-8000-000000000001",
          targetSessionID: chat.id,
          fromSessionID: SessionID.make("ses_cprime_sender_sessionx"),
          fromSlug: "sender-x",
          capsule: JSON.stringify({
            v: 1,
            id: "01999999-aaaa-7000-8000-000000000001",
            sender_session_id: "ses_cprime_sender_sessionx",
            sender_slug: "sender-x",
            body: "cprime-payload",
            created_at: Date.now(),
          }),
          timeCreated: Date.now(),
        })

        // The C′ poller (forked above) must claim this WITHOUT another loop.
        // Poll-wait up to ~5s (OPENCODE_S2S_POLL_MS should be small).
        let undelivered = yield* store.countUndelivered(chat.id)
        for (let i = 0; i < 25 && undelivered > 0; i++) {
          yield* Effect.sleep("200 millis")
          undelivered = yield* store.countUndelivered(chat.id)
        }

        // THE assertion: the row is claimed by the C′ poller.
        expect(undelivered).toBe(0)
      }),
    // Generous timeout: the poll-wait alone is up to 5s; batch contention adds
    // setup slack. Keep it well above bun's 5000ms default so a slow CI run
    // can't false-fail this real fiber-timing test.
    15000,
  )

  // Phase-3 hypothesis test: the C′ poller ONLY exists if loop ran in this
  // process. A session that never ran loop (the real recipient scenario: an
  // idle window that hasn't taken a turn since its process started) has NO
  // poller, so an inserted row is NEVER claimed. If this assertion holds
  // (undelivered stays > 0), the root cause is the fork being tied to loop.
  it.instance(
    "WITHOUT ever calling loop, an inserted s2s_inbox row is NEVER claimed (no poller forked)",
    () =>
      Effect.gen(function* () {
        yield* useServerConfig(providerCfgFor)
        const sessions = yield* Session.Service
        const store = yield* S2SStore.Service

        const chat = yield* sessions.create({
          title: "no-loop repro",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // NO prompt.prompt, NO prompt.loop — nothing forks a poller.
        yield* store.insertInbox({
          id: "01999999-bbbb-7000-8000-000000000002",
          targetSessionID: chat.id,
          fromSessionID: SessionID.make("ses_cprime_sender_sessiony"),
          fromSlug: "sender-y",
          capsule: JSON.stringify({
            v: 1,
            id: "01999999-bbbb-7000-8000-000000000002",
            sender_session_id: "ses_cprime_sender_sessiony",
            sender_slug: "sender-y",
            body: "no-loop-payload",
            created_at: Date.now(),
          }),
          timeCreated: Date.now(),
        })

        // Wait well past several poll intervals. With no poller, nothing claims.
        yield* Effect.sleep("2 seconds")
        const undelivered = yield* store.countUndelivered(chat.id)

        // Hypothesis: stays unclaimed because no poller was ever forked.
        expect(undelivered).toBe(1)
      }),
    // 2s fixed wait + setup; keep above the 5000ms default for batch slack.
    15000,
  )
})
