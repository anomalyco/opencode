// Session-to-Session — Task 0 spike test.
//
// Validates the V1 idle-wake premise end-to-end at the unit level:
//   A session that already has a committed user turn + assistant turn, and
//   is therefore IDLE, can be woken by pushing an item into Messaging.inbox
//   and then calling SessionPrompt.loop({ sessionID }). The runLoop's turn
//   boundary (prompt.ts:1216-1262) must drain the inbox and inject a single
//   new user message whose non-synthetic part carries an `inbox` marker
//   (slug + body) so the TUI / downstream code can key off it.
//
// This is the load-bearing spike for the S2S feature. If this test fails in
// a way that suggests `loop` does NOT drain the inbox on an idle session,
// the entire V1 design premise is wrong and the S2S plan must be re-thunk.
//
// Mirrors the `makeRunLoopLayer` factory + `runLoopIt.instance` pattern from
// `test/tool/coordinator-messaging.test.ts` (which already exercises the
// same drain path) but framed as a minimal, self-contained spike.

import { afterEach, describe, expect } from "bun:test"
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
import { Shell } from "@opencode-ai/core/shell"
import { S2SStore } from '../../src/s2s/store';
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

// ---------------------------------------------------------------------------
// Stubs (mirrored from coordinator-messaging.test.ts).
// ---------------------------------------------------------------------------

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
    startAuth: () => Effect.die("unexpected MCP auth in wakeup-spike test"),
    authenticate: () => Effect.die("unexpected MCP auth in wakeup-spike test"),
    finishAuth: () => Effect.die("unexpected MCP auth in wakeup-spike test"),
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

const providerRef = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
} as const

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
  const flags = RuntimeFlags.layer({ experimentalEventSystem: true, experimentalAgentMessaging: true })
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
    [RuntimeFlags.node, flags],
    [SessionStatus.node, statusNode],
    [SessionRunState.node, runStateNode],
  ]
  return LayerNode.compile(root, replacements)
}

const spikeLayer = Layer.mergeAll(TestLLMServer.layer, makeRunLoopLayer())
const it = testEffectIsolatedShared(spikeLayer as unknown as Layer.Layer<any, any, never>)

const writeConfig = Effect.fn("WakeupSpike.writeConfig")(function* (
  dir: string,
  config: Partial<ConfigV1.Info>,
) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("WakeupSpike.useServerConfig")(function* (
  config: (url: string) => Partial<ConfigV1.Info>,
) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

describe("s2s spike: V1 idle-wake via inbox drain (Task 0)", () => {
  it.instance(
    "idle session with queued inbox item wakes on SessionPrompt.loop and surfaces ✉ inbox marker (slug, not ses_)",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfgFor)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const messaging = yield* Messaging.Service

        // (1) Create the session. (NOTE: this does NOT create a user message.)
        const chat = yield* sessions.create({
          title: "Wakeup spike",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // (2) Seed a committed user+assistant turn so the session is IDLE
        //     and has a `lastUser`. Without this, runLoop throws
        //     "No user message found" (prompt.ts:1157).
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "warm-up" }],
        })
        yield* llm.text("warm-up-reply")

        // (3) Queue an inbox item from a sibling into this idle session.
        //     This is the V2 S2S wake primitive: someone pushes a message
        //     and the coordinator (or another process) eventually calls
        //     `loop` to drain it.
        yield* messaging.registerSlug("target", chat.id)
        const fromSession = SessionID.make("ses_spike_sender_sessionxxx")
        yield* messaging.enqueue({
          target: chat.id,
          from: fromSession,
          fromSlug: "rev-a",
          body: "wake-up-payload",
        })

        // (4) The wake itself: `SessionPrompt.loop` is the V1 mechanism.
        //     If V1 is correct, the turn boundary (prompt.ts:1216-1262)
        //     drains the inbox and injects a user message carrying the
        //     ✉ inbox marker.
        yield* prompt.loop({ sessionID: chat.id })

        // (5) Inbox is drained.
        expect((yield* messaging.drain(chat.id))).toEqual([])

        // (6) Transcript contains a non-synthetic part with an inbox marker
        //     whose text mentions the sender slug (NOT a ses_ id) and the body.
        const messages = yield* sessions.messages({ sessionID: chat.id })
        const inboxMarkers = messages.flatMap((m) => m.parts).filter(
          (p) =>
            p.type === "text" &&
            p.synthetic === false &&
            (p.metadata as { marker?: { kind?: string } } | undefined)?.marker?.kind === "inbox",
        )
        expect(inboxMarkers.length).toBeGreaterThanOrEqual(1)
        const marker = inboxMarkers[0]!
        if (marker.type !== "text") throw new Error("unreachable: type narrowed above")
        expect(marker.text).toContain("rev-a")
        expect(marker.text).not.toMatch(/ses_/)
        expect(marker.text).toContain("wake-up-payload")
        // metadata.tag carries the slug so the TUI / downstream code can
        // branch on the from without re-parsing the visible line.
        expect(marker.metadata).toMatchObject({ marker: { kind: "inbox", from: "rev-a" } })
      }),
  )
})
