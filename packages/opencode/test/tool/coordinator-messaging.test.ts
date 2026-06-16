import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
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
import { Question } from "../../src/question"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Shell } from "@opencode-ai/core/shell"
import { Skill } from "../../src/skill"
import { Snapshot } from "@/snapshot"
import { SystemPrompt } from "@/session/system"
import { Todo } from "@/session/todo"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { MessageID, SessionID } from "../../src/session/schema"
import { MessageTool } from "../../src/tool/message"

afterEach(async () => {
  await disposeAllInstances()
})

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  EventV2Bridge.defaultLayer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Session.defaultLayer,
  SessionRunState.defaultLayer,
  SessionStatus.defaultLayer,
  Truncate.defaultLayer,
  ToolRegistry.defaultLayer,
  Permission.defaultLayer,
  Database.defaultLayer,
  Messaging.layer.pipe(Layer.provideMerge(EventV2Bridge.defaultLayer)),
  RuntimeFlags.layer({}),
).pipe(Layer.provide(Ripgrep.defaultLayer))

const it = testEffect(layer)

// Seed a session with an optional parentID. The session ID is auto-assigned by
// Session.Service.create (we cannot inject one); the returned ID is the source
// of truth for all sibling-hood / allow-list assertions below.
const seedSession = Effect.fn("CoordinatorMessagingTest.seedSession")(function* (parentID?: SessionID) {
  const sessions = yield* Session.Service
  return yield* sessions.create({ parentID, title: "test", agent: "build" })
})

function ctxFor(sessionID: SessionID): import("../../src/tool/tool").Context {
  return {
    sessionID,
    messageID: MessageID.make("msg_test"),
    agent: "build",
    abort: new AbortController().signal,
    extra: {},
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

describe("tool.message peer-slug send (sibling / coordinator)", () => {
  it.instance(
    "allow-listed sibling send lands in target's inbox; non-sibling + non-allowed + expect_reply all reject",
    () =>
      Effect.gen(function* () {
        const m = yield* Messaging.Service
        const sesP = yield* seedSession()
        const sesA = yield* seedSession(sesP.id)
        const sesB = yield* seedSession(sesP.id)
        const sesC = yield* seedSession(SessionID.make("ses_otherparentotherparentx"))
        yield* m.registerSlug("rev-a", sesA.id)
        yield* m.registerSlug("rev-b", sesB.id)
        yield* m.registerSlug("out-c", sesC.id)
        yield* m.setAllow(sesA.id, ["rev-b"])

        const tool = yield* MessageTool
        const def = yield* tool.init()
        const ctxA = ctxFor(sesA.id)

        // (1) allow-listed sibling send → lands in B's inbox.
        const ok = yield* def.execute({ target: "rev-b", body: "hi-b" }, ctxA)
        expect(ok.output).toBe("Queued to recipient inbox.")
        const inboxB = yield* m.drain(sesB.id)
        expect(inboxB.map((x) => x.body)).toEqual(["hi-b"])
        expect(inboxB.map((x) => x.fromSlug)).toEqual(["rev-a"])

        // (2) not allow-listed → reject.
        const deniedExit = yield* def
          .execute({ target: "out-c", body: "x" }, ctxA)
          .pipe(Effect.exit)
        expect(Exit.isFailure(deniedExit)).toBe(true)
        if (Exit.isFailure(deniedExit)) {
          const err = Cause.squash(deniedExit.cause)
          expect(String(err)).toContain("is not in your message_allow list")
        }

        // (3) allow-listed but cross-parentID → reject (sibling-hood check).
        yield* m.setAllow(sesA.id, ["rev-b", "out-c"])
        const crossExit = yield* def
          .execute({ target: "out-c", body: "x" }, ctxA)
          .pipe(Effect.exit)
        expect(Exit.isFailure(crossExit)).toBe(true)
        if (Exit.isFailure(crossExit)) {
          const err = Cause.squash(crossExit.cause)
          expect(String(err)).toContain("is not a sibling (parent mismatch)")
        }

        // (4) expect_reply to a peer → reject at the tool boundary.
        const replyExit = yield* def
          .execute({ target: "rev-b", body: "x", expect_reply: true }, ctxA)
          .pipe(Effect.exit)
        expect(Exit.isFailure(replyExit)).toBe(true)
        if (Exit.isFailure(replyExit)) {
          const err = Cause.squash(replyExit.cause)
          expect(String(err)).toContain("expect_reply is not allowed for peer messaging")
        }
      }),
  )

  it.instance("target slug that has not spawned → reject", () =>
    Effect.gen(function* () {
      const m = yield* Messaging.Service
      const sesP = yield* seedSession()
      const sesA = yield* seedSession(sesP.id)
      yield* m.setAllow(sesA.id, ["ghost-slug"])

      const tool = yield* MessageTool
      const def = yield* tool.init()
      const exit = yield* def
        .execute({ target: "ghost-slug", body: "x" }, ctxFor(sesA.id))
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(String(err)).toContain("has not spawned yet")
      }
    }),
  )
})

// ---------------------------------------------------------------------------
// runLoop inbox-drain integration (Task 5)
// ---------------------------------------------------------------------------
//
// Mirrors the `makePrompt` / `useServerConfig` harness from test/session/prompt.test.ts
// but kept local so this test file is self-contained. The layer below is the minimum
// needed for `SessionPrompt.loop` to run, with the same mocks for LSP/MCP/Summary
// and a stubbed Config (via opencode.json written to the tmpdir) that points the
// `test` provider at the TestLLMServer URL.

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
    startAuth: () => Effect.die("unexpected MCP auth in coordinator-messaging drain test"),
    authenticate: () => Effect.die("unexpected MCP auth in coordinator-messaging drain test"),
    finishAuth: () => Effect.die("unexpected MCP auth in coordinator-messaging drain test"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
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

const runLoopStatus = SessionStatus.layer.pipe(Layer.provideMerge(EventV2Bridge.defaultLayer))
const runLoopRunState = SessionRunState.layer.pipe(Layer.provide(runLoopStatus))
const runLoopInfra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

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

function makeRunLoopLayer(flagOn: boolean) {
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
    lspStub,
    mcpStub,
    FSUtil.defaultLayer,
    BackgroundJob.defaultLayer,
    runLoopStatus,
    Database.defaultLayer,
    EventV2Bridge.defaultLayer,
    Interrupt.defaultLayer,
  ).pipe(Layer.provideMerge(runLoopInfra))
  const messaging = Messaging.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer
    .pipe(
      Layer.provide(Skill.defaultLayer),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(CrossSpawnSpawner.defaultLayer),
      Layer.provide(Git.defaultLayer),
      Layer.provide(Ripgrep.defaultLayer),
      Layer.provide(Format.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true, experimentalAgentMessaging: true })),
      Layer.provideMerge(todo),
      Layer.provideMerge(question),
      Layer.provideMerge(messaging),
      Layer.provideMerge(deps),
    )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(
    Layer.provide(summaryStub),
    Layer.provide(Image.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer
    .pipe(
      Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
      Layer.provideMerge(proc),
      Layer.provideMerge(deps),
    )
  return SessionPrompt.layer.pipe(
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(summaryStub),
    Layer.provideMerge(runLoopRunState),
    Layer.provideMerge(compact),
    Layer.provideMerge(proc),
    Layer.provideMerge(registry),
    Layer.provideMerge(trunc),
    Layer.provideMerge(messaging),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(SystemPrompt.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true, experimentalAgentMessaging: flagOn })),
    Layer.provideMerge(deps),
    Layer.provide(summaryStub),
  )
}

const runLoopLayerFlagOn = Layer.mergeAll(TestLLMServer.layer, makeRunLoopLayer(true))
const runLoopLayerFlagOff = Layer.mergeAll(TestLLMServer.layer, makeRunLoopLayer(false))
const runLoopIt = testEffect(runLoopLayerFlagOn)
const runLoopItFlagOff = testEffect(runLoopLayerFlagOff)

const writeConfig = Effect.fn("CoordinatorMessagingDrainTest.writeConfig")(function* (
  dir: string,
  config: Partial<ConfigV1.Info>,
) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("CoordinatorMessagingDrainTest.useServerConfig")(function* (
  config: (url: string) => Partial<ConfigV1.Info>,
) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

describe("runLoop coordinator inbox drain (Task 5)", () => {
  runLoopIt.instance(
    "drains queued inbox at turn boundary: 1 user msg, 2N parts, slug 'rev-a', inbox empty",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfgFor)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const messaging = yield* Messaging.Service

        const chat = yield* sessions.create({
          title: "Drain fires",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        // Seed the initial user message via prompt.prompt(noReply) so the runLoop
        // sees a real user message on iteration 1.
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        // Queue the LLM response for the turn that will see the drained inbox.
        yield* llm.text("after-drain")

        // Register the session slug and enqueue two items to its inbox.
        yield* messaging.registerSlug("target", chat.id)
        const fromSession = SessionID.make("ses_zzzzzzzzzzzzzzzzzzzzzzzz")
        yield* messaging.enqueue({ target: chat.id, from: fromSession, fromSlug: "rev-a", body: "msg-one" })
        yield* messaging.enqueue({ target: chat.id, from: fromSession, fromSlug: "rev-a", body: "msg-two" })

        yield* prompt.loop({ sessionID: chat.id })

        // Inbox is empty.
        expect((yield* messaging.drain(chat.id))).toEqual([])

        // The transcript has exactly ONE new user message added by the drain
        // (separate from the seeded "hello" user message). It must carry 2N
        // parts: N synthetic <agent_message> frames + N non-synthetic ✉ markers,
        // each containing the human slug "rev-a" (NOT a ses_ id).
        const messages = yield* sessions.messages({ sessionID: chat.id })
        const drainMsgs = messages.filter(
          (m) =>
            m.info.role === "user" &&
            m.parts.some((p) => p.type === "text" && p.synthetic === true && p.text.includes("<agent_message")),
        )
        expect(drainMsgs).toHaveLength(1)
        const drainMsg = drainMsgs[0]!
        const syntheticFrames = drainMsg.parts.filter(
          (p) => p.type === "text" && p.synthetic === true && p.text.includes("<agent_message"),
        )
        expect(syntheticFrames).toHaveLength(2)
        const frameBodies = syntheticFrames
          .map((f) => (f.type === "text" ? f.text : ""))
          .map((t) => t.replace(/<\/?agent_message[^>]*>/g, "").replace(/from="[^"]*"/g, "").trim())
        expect(frameBodies.sort()).toEqual(["msg-one", "msg-two"])
        for (const frame of syntheticFrames) {
          if (frame.type !== "text") continue
          expect(frame.text).toContain(`from="rev-a"`)
          expect(frame.text).not.toMatch(/from="ses_/)
        }
        const visibleMarkers = drainMsg.parts.filter(
          (p) => p.type === "text" && p.synthetic === false && p.text.startsWith("✉ Inbox from "),
        )
        expect(visibleMarkers).toHaveLength(2)
        for (const marker of visibleMarkers) {
          if (marker.type !== "text") continue
          expect(marker.text).toContain("rev-a")
          expect(marker.text).not.toMatch(/ses_/)
          // metadata is tagged so the TUI keys off metadata.marker.kind === "inbox"
          expect(marker.metadata).toMatchObject({ marker: { kind: "inbox", from: "rev-a" } })
        }
      }),
  )

  runLoopIt.instance(
    "skips drain on the iteration that consumes a cancel: cancel user msg has only cancel parts (no inbox parts)",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfgFor)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const messaging = yield* Messaging.Service
        const interrupt = yield* Interrupt.Service

        const chat = yield* sessions.create({
          title: "Drain skipped on cancel",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        yield* llm.text("cancel-ack")

        yield* messaging.registerSlug("target", chat.id)
        const fromSession = SessionID.make("ses_yyyyyyyyyyyyyyyyyyyyyyyy")
        yield* messaging.enqueue({ target: chat.id, from: fromSession, fromSlug: "rev-a", body: "queued-1" })
        yield* messaging.enqueue({ target: chat.id, from: fromSession, fromSlug: "rev-a", body: "queued-2" })
        // Seed a cancel interrupt so iteration 1's interrupt block consumes it.
        yield* interrupt.request({
          sessionID: chat.id,
          intent: "cancel",
          reason: "STOP_REASON_X",
          origin: "parent",
        })

        yield* prompt.loop({ sessionID: chat.id })

        // The cancel marker is present (proves the cancel branch was taken).
        const messages = yield* sessions.messages({ sessionID: chat.id })
        const cancelUserMsgs = messages.filter(
          (m) =>
            m.info.role === "user" &&
            m.parts.some(
              (p) => p.type === "text" && p.synthetic === true && p.text.includes("<cancel"),
            ),
        )
        expect(cancelUserMsgs).toHaveLength(1)
        const cancelMsg = cancelUserMsgs[0]!

        // The drain block was SKIPPED on the iteration that consumed the cancel.
        // The cancel user message therefore carries only the 2 cancel parts
        // (synthetic frame + visible marker) — NO inbox parts are mixed in.
        const inboxPartsOnCancelMsg = cancelMsg.parts.filter(
          (p) =>
            p.type === "text" &&
            (p.text.includes("<agent_message") ||
              p.text.startsWith("✉ Inbox from ") ||
              (p.metadata as { marker?: { kind?: string } } | undefined)?.marker?.kind === "inbox"),
        )
        expect(inboxPartsOnCancelMsg).toHaveLength(0)
        // Sanity: the cancel user message has exactly 2 parts.
        expect(cancelMsg.parts).toHaveLength(2)
      }),
  )

  runLoopItFlagOff.instance(
    "skips drain when experimentalAgentMessaging flag is off: inbox stays full, no inbox parts in transcript",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfgFor)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const messaging = yield* Messaging.Service

        const chat = yield* sessions.create({
          title: "Drain off (flag false)",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        yield* llm.text("after-flag-off")

        yield* messaging.registerSlug("target", chat.id)
        const fromSession = SessionID.make("ses_wwwwwwwwwwwwwwwwwwwwwwww")
        yield* messaging.enqueue({ target: chat.id, from: fromSession, fromSlug: "rev-a", body: "stay-1" })
        yield* messaging.enqueue({ target: chat.id, from: fromSession, fromSlug: "rev-a", body: "stay-2" })

        yield* prompt.loop({ sessionID: chat.id })

        // Flag is off → drain did not run → inbox still has the 2 items.
        const remaining = yield* messaging.drain(chat.id)
        expect(remaining.map((x) => x.body).sort()).toEqual(["stay-1", "stay-2"])

        // No inbox user message was injected.
        const messages = yield* sessions.messages({ sessionID: chat.id })
        const drainMsgs = messages.filter((m) =>
          m.parts.some(
            (p) =>
              p.type === "text" &&
              (p.text.includes("<agent_message") ||
                p.text.startsWith("✉ Inbox from ") ||
                (p.metadata as { marker?: { kind?: string } } | undefined)?.marker?.kind === "inbox"),
          ),
        )
        expect(drainMsgs).toHaveLength(0)
      }),
  )
})
