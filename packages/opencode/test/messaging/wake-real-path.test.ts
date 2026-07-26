// Wake-on-message — real-path integration test (Bug 3 fix).
//
// wake.test.ts (predicate unit tests) uses spy handlers and a minimal
// Messaging-only layer; it never builds the real SessionPrompt.layer, never
// runs the real `messaging.registerWakeHandler((sessionID) => loop(...))`
// registration line, and never runs a real `prompt.loop`/`runLoop` turn. A
// registration bug (missing `yield*`) or a context-losing fork (bare
// `Effect.runFork`) can pass all of wake.test.ts while the feature is
// completely dead in production — which is exactly what happened.
//
// This test builds the full real run-loop layer (mirrors
// test/s2s/cprime-fork.test.ts's makeRunLoopLayer), drives a session through
// SessionPrompt.loop for real (which is what registers the wake handler),
// sets a real wake policy, and enqueues through the REAL Messaging.enqueue —
// the same call task.ts and the message/s2s tools make in production. The
// only way the child's transcript picks up the enqueued message without a
// second explicit `loop()` call is if:
//   (a) registration actually ran (Bug 1), AND
//   (b) the forked handler retained InstanceRef so it could run
//       SessionStatus/SessionRunState/Session (all InstanceState-scoped)
//       without dying (Bug 2).
// Dropping either fix reproduces the RED failure below (see the fix's
// commit message / return summary for the before/after run transcripts).

import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
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
import { pollWithTimeout, testEffectShared } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { WAKE_BUDGET_DEFAULT } from "../../src/tool/task"

afterEach(async () => {
  await disposeAllInstances()
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
    startAuth: () => Effect.die("unexpected MCP auth in wake-real-path test"),
    authenticate: () => Effect.die("unexpected MCP auth in wake-real-path test"),
    finishAuth: () => Effect.die("unexpected MCP auth in wake-real-path test"),
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

// experimentalS2S stays OFF here — wake-on-message (task.ts's wake_on_message
// param → Messaging.setWakePolicy) is independent of the s2s cross-process
// lifecycle. experimentalAgentMessaging is ON so runLoop's turn-boundary
// drain block (prompt.ts, gated on that flag) actually consumes the queued
// inbox item once the wake fires.
const wakeFlags = RuntimeFlags.layer({
  experimentalEventSystem: true,
  experimentalAgentMessaging: true,
  experimentalS2S: false,
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
    [RuntimeFlags.node, wakeFlags],
    [SessionStatus.node, statusNode],
    [SessionRunState.node, runStateNode],
  ]
  return LayerNode.compile(root, replacements)
}

const wakeLayer = Layer.mergeAll(TestLLMServer.layer, makeRunLoopLayer())
const it = testEffectShared(wakeLayer as unknown as Layer.Layer<any, any, never>)

const writeConfig = Effect.fn("WakeRealPath.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("WakeRealPath.useServerConfig")(function* (
  config: (url: string) => Partial<ConfigV1.Info>,
) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

describe("wake-on-message: real path (SessionPrompt.layer + real Messaging.enqueue + real prompt.loop)", () => {
  it.instance(
    "an idle child with a wake policy drains a real Messaging.enqueue without a second explicit loop() call",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfgFor)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const messaging = yield* Messaging.Service

        // Realistic tree: a coordinator dispatches a child (wake_on_message: true
        // in production is just messaging.setWakePolicy below — task.ts's own
        // wiring is not under test here) and a sibling that pings it later.
        const coordinator = yield* sessions.create({
          title: "coordinator",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        const child = yield* sessions.create({
          parentID: coordinator.id,
          title: "wake child (@build subagent)",
          agent: "build",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        const sibling = yield* sessions.create({
          parentID: coordinator.id,
          title: "sibling",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // Seed the child with a committed user+assistant turn so it is IDLE
        // with a lastUser (a zero-message session would throw at the top of
        // runLoop). Calling prompt.loop here is the FIRST loop() call for this
        // session — with the fix, this is also the call that (for real, via
        // the yield*ed registration) sets Messaging's wakeHandler.
        yield* prompt.prompt({
          sessionID: child.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "warm-up" }],
        })
        yield* llm.text("warm-up-reply")
        yield* prompt.loop({ sessionID: child.id })

        // The same call task.ts makes for wake_on_message: true.
        yield* messaging.setWakePolicy({ sessionID: child.id, budget: WAKE_BUDGET_DEFAULT })

        // Queue the LLM response for the turn the wake will trigger.
        yield* llm.text("post-wake-reply")

        // THE production seam: a sibling/coordinator message lands via the
        // real Messaging.enqueue (not a spy, not a stub) while the child is
        // idle. This must trigger wakeIfIdle → the registered handler →
        // a fork that retains InstanceRef → prompt.loop({ sessionID: child.id })
        // → runLoop's turn-boundary drain — all WITHOUT this test calling
        // prompt.loop a second time itself.
        yield* messaging.enqueue({
          target: child.id,
          from: sibling.id,
          fromSlug: "sibling-x",
          body: "sibling ping",
        })

        // Poll for the drain's observable side effect: the inbox marker part
        // appended to the child's transcript by runLoop (prompt.ts's
        // turn-boundary drain block), which only runs inside a real loop()
        // execution. This is the assertion that fails RED if registration
        // was dropped (Bug 1) or the fork lost InstanceRef and died before
        // reaching runLoop (Bug 2) — in both cases nothing ever calls loop()
        // again, so this marker never appears and the inbox stays parked.
        const findMarker = Effect.gen(function* () {
          const messages = yield* sessions.messages({ sessionID: child.id })
          return messages
            .flatMap((m) => m.parts)
            .find(
              (p) =>
                p.type === "text" &&
                p.synthetic === false &&
                (p.metadata as { marker?: { kind?: string } } | undefined)?.marker?.kind === "inbox",
            )
        })

        const marker = yield* pollWithTimeout(findMarker, "wake-on-message real path: inbox marker never appeared", "5 seconds")

        if (marker.type !== "text") throw new Error("unreachable: type narrowed above")
        expect(marker.text).toContain("sibling-x")
        expect(marker.text).toContain("sibling ping")
        expect(marker.metadata).toMatchObject({ marker: { kind: "inbox", from: "sibling-x" } })

        // The real-path wake drained the inbox — nothing left to drain.
        expect(yield* messaging.drain(child.id)).toEqual([])
      }),
    // Generous timeout: the poll-wait alone is up to 5s (25 * 200ms); the two
    // real LLM turns (warm-up + post-wake) add setup slack.
    15000,
  )
})
