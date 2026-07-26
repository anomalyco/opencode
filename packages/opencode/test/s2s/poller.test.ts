// Session-to-Session — Task 5 (per-process poller + 60s reaper + V1 idle-wake).
//
// Validates the S2SPoller service end-to-end at the unit level:
//
//   1. pollOnce() for a row whose target is in this process's local-set
//      claims it (drained_at set in the s2s_inbox table), enqueues the
//      capsule body into the in-process Messaging inbox tagged with
//      source="sibling-session", then — because the target is idle and has
//      a committed lastUser — wakes it by calling SessionPrompt.loop. The
//      runLoop's drain block (prompt.ts:1216-1262, gated on
//      flags.experimentalAgentMessaging) consumes the inbox at the turn
//      boundary and injects a user message whose non-synthetic part carries
//      a ✉ inbox marker for the foreign sender (slug "peer-z", body
//      "POLL-PAYLOAD-1"). After the loop the inbox is empty and the row
//      is deleted (a second pollOnce returns nothing).
//
//   2. pollOnce() for a row whose target is NOT in this process's
//      local-set is left untouched. claimForSessions only returns rows
//      whose target_session_id is in the local set, so no claim SQL fires.
//
//   3. A delivered row is hard-deleted by processRow, so a later reapOnce
//      cannot resurrect it — the body is delivered EXACTLY ONCE even across
//      a reap (the M2 regression). The reaper only ever reopens a CRASHED
//      claim (claimed but never deleted), which store.test.ts covers
//      directly.
//
// The harness reuses the runLoop plumbing from `wakeup-spike.test.ts` and
// `tool/coordinator-messaging.test.ts` (stubs for LSP/MCP/Summary, the
// TestLLMServer + provider cfg) and adds the S2SStore + S2SPoller layers
// on top so the poller has a real in-memory SQLite (Database.layerFromPath)
// to read/write against.

import { afterEach, describe, expect } from "bun:test"
import { Duration, Effect, Layer, Option } from "effect"
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
import { SessionTable } from "@opencode-ai/core/session/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Env } from "../../src/env"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Format } from "../../src/format"
import { Git } from "@/git"
import { Image } from "@/image/image"
import { Instruction } from "@/session/instruction"
import { Interrupt } from "@/session/interrupt"
import { LLM } from "@/session/llm"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Messaging } from "../../src/messaging"
import { ModelV2 } from "@opencode-ai/core/model"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Question } from "@/question"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { S2SPoller } from "../../src/s2s/poller"
import { S2SStore } from "../../src/s2s/store"
import { Session } from "@/session/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionCompaction } from "@/session/compaction"
import { SessionID } from "../../src/session/schema"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Skill } from "@/skill"
import { Snapshot } from "@/snapshot"
import { SystemPrompt } from "@/session/system"
import { encodeCapsule } from "../../src/s2s/capsule"
import { Todo } from "@/session/todo"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { TestInstance, disposeAllInstances } from "../fixture/fixture"
import { testEffect, testEffectShared } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

afterEach(async () => {
  await disposeAllInstances()
})

// ---------------------------------------------------------------------------
// Stubs (mirrored from wakeup-spike.test.ts).
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
    startAuth: () => Effect.die("unexpected MCP auth in poller test"),
    authenticate: () => Effect.die("unexpected MCP auth in poller test"),
    finishAuth: () => Effect.die("unexpected MCP auth in poller test"),
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

// in-memory SQLite so the poller's claimForSessions / reapStale / insertInbox
// run against a real database (not a mock). The poller test shares the layer
// across the describe block — Bun's `Database(":memory:")` gives one in-memory
// handle per native handle, so sharing the layer guarantees all services
// resolved by this layer see the same handle.
const database = Database.layerFromPath(":memory:")

function makeRunLoopLayer() {
  const flags = RuntimeFlags.layer({
    experimentalEventSystem: true,
    experimentalAgentMessaging: true,
    experimentalS2S: false,
  })
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
    // Same :memory: layer instance the poller-side S2SStore receives via
    // Layer.provide(database) below — one handle for both worlds, matching
    // the old-base sharing semantics under testEffectShared's memoMap.
    [Database.node, database],
  ]
  return LayerNode.compile(root, replacements)
}

// Adds S2SStore + S2SPoller on top of the runLoop layer. S2SPoller depends on
// S2SStore + Messaging + Session + SessionStatus + SessionPrompt + RuntimeFlags
// — all of which are resolved by the runLoop layer, except RuntimeFlags which
// the runLoop only `Layer.provide`s to its inner services (it is not surfaced
// to the test effect's own context). Re-provide it here so the poller's
// `yield* RuntimeFlags.Service` resolves and the S2S-off override suppresses
// the background fork inside the poller layer.
const pollerLayer = Layer.provideMerge(
  Layer.provideMerge(S2SPoller.layer, S2SStore.defaultLayer),
  Layer.mergeAll(
    RuntimeFlags.layer({
      experimentalEventSystem: true,
      experimentalAgentMessaging: true,
      experimentalS2S: false,
    }),
    makeRunLoopLayer(),
  ),
)

const spikeLayer = Layer.mergeAll(TestLLMServer.layer, pollerLayer).pipe(Layer.provide(database))
const it = testEffect(spikeLayer as unknown as Layer.Layer<any, any, never>)

const writeConfig = Effect.fn("PollerTest.writeConfig")(function* (
  dir: string,
  config: Partial<ConfigV1.Info>,
) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("PollerTest.useServerConfig")(function* (
  config: (url: string) => Partial<ConfigV1.Info>,
) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

// A well-formed v1 capsule payload. The poller will decode this from the
// s2s_inbox row, so it must round-trip through decodeCapsuleOption.
const capsule = (body: string, senderSlug = "peer-z", senderSessionID = "ses_peer_sender_xxxxxxxxxxx") =>
  encodeCapsule({
    version: 1,
    id: "0190abcd-7abc-7abc-8abc-0190abcdef01",
    sender_slug: senderSlug,
    sender_session_id: senderSessionID,
    timestamp: 1_700_000_000_000,
    body,
  })

describe("S2SPoller: reaper cutoff advances per tick (FIX 1 regression guard)", () => {
  // Proves that the background reap loop uses Effect.suspend(() => reapOnceImpl(Date.now()))
  // so that Date.now() is evaluated fresh on EACH tick, not once at layer construction.
  //
  // Strategy: set OPENCODE_S2S_REAP_WINDOW_MS=5 (5ms reap window + 5ms interval).
  // Claim a row. Wait 30ms. A frozen cutoff (T_construction - 5ms) would be BEFORE
  // drained_at (which is >= T_construction), so the frozen reaper never fires.
  // A fresh cutoff (Date.now() - 5ms, re-evaluated each 5ms tick) advances past
  // drained_at after ~5ms, so the row IS reaped. The test asserts the row is
  // reclaimable after 30ms — which only succeeds when the cutoff advances.
  //
  // To avoid pulling in the full runLoop, the poll loop is neutralised by a stub
  // Messaging that returns localSet: [] (poll exits immediately when no local
  // sessions are registered). Session/SessionStatus/SessionPrompt stubs die on
  // any call — they must never be reached.

  // Minimal stubs — the poll loop exits early because localSet() returns [].
  const messagingStub = Layer.succeed(
    Messaging.Service,
    Messaging.Service.of({
      send: () => Effect.die("unexpected Messaging.send in reaper test"),
      reply: () => Effect.die("unexpected Messaging.reply in reaper test"),
      reject: () => Effect.die("unexpected Messaging.reject in reaper test"),
      list: () => Effect.die("unexpected Messaging.list in reaper test"),
      registerSlug: () => Effect.die("unexpected Messaging.registerSlug in reaper test"),
      resolveSlug: () => Effect.die("unexpected Messaging.resolveSlug in reaper test"),
      setAllow: () => Effect.die("unexpected Messaging.setAllow in reaper test"),
      getAllow: () => Effect.die("unexpected Messaging.getAllow in reaper test"),
      slugFor: () => Effect.die("unexpected Messaging.slugFor in reaper test"),
      enqueue: () => Effect.die("unexpected Messaging.enqueue in reaper test"),
      drain: () => Effect.die("unexpected Messaging.drain in reaper test"),
      awaitInbox: () => Effect.die("unexpected Messaging.awaitInbox in reaper test"),
      // The poll loop calls localSet() first; empty list → early exit → no rows
      // processed → Session/SessionStatus/SessionPrompt stubs never invoked.
      localSet: () => Effect.succeed([]),
      isLocal: () => Effect.succeed(false),
      registerLocal: () => Effect.void,
      registerWakeHandler: () => Effect.die("unexpected Messaging.registerWakeHandler in reaper test"),
      setWakePolicy: () => Effect.die("unexpected Messaging.setWakePolicy in reaper test"),
    }),
  )

  const sessionStub = Layer.succeed(
    Session.Service,
    // @ts-expect-error — intentional: this service must not be called in this test
    Session.Service.of({}),
  )

  const sessionStatusStub = Layer.succeed(
    SessionStatus.Service,
    // @ts-expect-error — intentional: this service must not be called in this test
    SessionStatus.Service.of({}),
  )

  const sessionPromptStub = Layer.succeed(
    SessionPrompt.Service,
    // @ts-expect-error — intentional: this service must not be called in this test
    SessionPrompt.Service.of({}),
  )

  const reaperDatabase = Database.layerFromPath(":memory:")

  // Sets OPENCODE_S2S_REAP_WINDOW_MS=5 so the background loop fires every 5ms
  // with a 5ms reap window. The env var is read at layer construction time.
  // Other tests use experimentalS2S: false so the background loop never starts
  // there — the env var is harmless to them.
  const makeReaperLoopLayer = () => {
    process.env["OPENCODE_S2S_REAP_WINDOW_MS"] = "5"
    // Slow poll so it never fires during the test (only the reaper is tested).
    process.env["OPENCODE_S2S_POLL_MS"] = "60000"
    return Layer.provideMerge(
      S2SPoller.layer,
      Layer.mergeAll(
        S2SStore.defaultLayer,
        messagingStub,
        sessionStub,
        sessionStatusStub,
        sessionPromptStub,
        EventV2Bridge.defaultLayer.pipe(Layer.provideMerge(EventV2.layerWith())),
        RuntimeFlags.layer({
          experimentalEventSystem: true,
          experimentalAgentMessaging: true,
          // S2S ON so the background reap loop starts.
          experimentalS2S: true,
        }),
      ),
    ).pipe(Layer.provideMerge(reaperDatabase))
  }

  const reaperLoopIt = testEffect(makeReaperLoopLayer() as unknown as Layer.Layer<any, any, never>)

  reaperLoopIt.live(
    "background reap loop advances its cutoff each tick (frozen form leaves row claimed)",
    () =>
      Effect.gen(function* () {
        const store = yield* S2SStore.Service
        // Use a session ID that is NOT in the local set (localSet returns [],
        // so any ID is "non-local"). The reap loop doesn't care about local-set.
        const targetID = SessionID.make("ses_reaper_target_xxxxxxxxx")
        const { db } = yield* Database.Service
        yield* db.insert(ProjectTable).values({ id: "prj_test", worktree: "/tmp", sandboxes: [], time_created: 1, time_updated: 1 } as any).run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: targetID,
          project_id: "prj_test",
          slug: "test-slug",
          directory: "/tmp",
          title: "test",
          version: "1",
          cost: 0,
          tokens_input: 0,
          tokens_output: 0,
          tokens_reasoning: 0,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          time_created: 1,
          time_updated: 1,
        } as any).run().pipe(Effect.orDie)

        yield* store.insertInbox({
          id: "inb_reaper_cutoff_1",
          targetSessionID: targetID,
          fromSessionID: SessionID.make("ses_reaper_sender_xxxxxxxxx"),
          fromSlug: "reaper-peer",
          capsule: capsule("REAPER-CUTOFF-PAYLOAD"),
          timeCreated: 1,
        })

        // Claim the row so drained_at = Date.now() at this moment.
        const claimed = yield* store.claimForSessions([targetID])
        expect(claimed.map((r) => r.id)).toEqual(["inb_reaper_cutoff_1"])

        // Wait 30ms — well beyond the 5ms reap window. The background loop
        // fires every 5ms. With a fresh Date.now() each tick:
        //   olderThan = Date.now() - 5
        // After 10ms from the claim: olderThan = T_claim + 10 - 5 = T_claim + 5 > T_claim
        // → row IS reaped (drained_at = T_claim < olderThan = T_claim + 5).
        //
        // With a FROZEN Date.now() (the bug): olderThan = T_construction - 5 < T_claim
        // → row is NEVER reaped (drained_at = T_claim > olderThan always).
        yield* Effect.sleep(Duration.millis(30))

        // After 30ms the row must be reclaimable (reaper reset drained_at to NULL).
        const reclaimed = yield* store.claimForSessions([targetID])
        expect(reclaimed.map((r) => r.id)).toEqual(["inb_reaper_cutoff_1"])
      }),
  )
})

describe("S2SPoller: per-process wake loop (Task 5)", () => {
  it.instance(
    "pollOnce claims a row for a local idle session, enqueues to inbox, wakes via prompt.loop, ✉ marker surfaces",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfgFor)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const messaging = yield* Messaging.Service
        const store = yield* S2SStore.Service
        const poller = yield* S2SPoller.Service

        // (1) Seed a local session with a committed lastUser so runLoop can
        //     run without throwing (prompt.ts:1157).
        const chat = yield* sessions.create({
          title: "Poller wake target",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "warm-up" }],
        })
        // Queue the canned LLM response. The poller will eventually call
        // prompt.loop; the runLoop drains the inbox BEFORE its first LLM
        // call, so the canned reply lands on the wake-up turn.
        yield* llm.text("after-drain")

        // (2) Mark the session as a local target + register its slug (enqueue
        //     requires the slug, see messaging/index.ts:330).
        yield* messaging.registerLocal(chat.id)
        yield* messaging.registerSlug("poller-target", chat.id)

        // (3) Insert a row for this target. Use a foreign (non-local) sender
        //     so we exercise the poller's "from from_session_id ?? target"
        //     fallback and the from_slug override.
        const foreign = SessionID.make("ses_peer_sender_xxxxxxxxxxx")
        yield* store.insertInbox({
          id: "inb_poller_1",
          targetSessionID: chat.id,
          fromSessionID: foreign,
          fromSlug: "peer-z",
          capsule: capsule("POLL-PAYLOAD-1"),
          timeCreated: 1,
        })

        // (4) Drive ONE poll cycle directly. The poller:
        //     a) claims the row (drained_at set),
        //     b) enqueues the body into the in-process inbox tagged
        //        source="sibling-session",
        //     c) wakes the idle session via prompt.loop, which drains the
        //        inbox at its next turn boundary and injects a user message
        //        carrying the ✉ inbox marker for "peer-z".
        yield* poller.pollOnce()

        // (5) Inbox is empty after the loop drained it.
        expect((yield* messaging.drain(chat.id))).toEqual([])

        // (6) The transcript gained a user message from the drain. The
        //     non-synthetic s2s inbox marker shows the sender NAME (falls back
        //     to the slug "peer-z" since this capsule carries no sender_name)
        //     AND the addressable sender session id, so the recipient knows who
        //     to message back, plus the body.
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
        expect(marker.text).toContain("peer-z")
        expect(marker.text).toContain(String(foreign)) // addressable sender session id is shown
        expect(marker.text).toContain("POLL-PAYLOAD-1")
        expect(marker.metadata).toMatchObject({
          marker: { kind: "inbox", from: "peer-z", sessionId: String(foreign) },
        })

        // (7) The row was deleted after delivery: a second pollOnce is a
        //     no-op. The delivered row is gone (not just claimed), so there
        //     is nothing left to claim or redeliver.
        yield* poller.pollOnce()
        // The inbox is still empty (we already drained, the second pollOnce
        // found no rows to claim).
        expect((yield* messaging.drain(chat.id))).toEqual([])
        expect(yield* store.countUndelivered(chat.id)).toBe(0)
      }),
  )

  it.instance(
    "pollOnce leaves a row unclaimed when the target is not in this process's local-set",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const messaging = yield* Messaging.Service
        const store = yield* S2SStore.Service
        const poller = yield* S2SPoller.Service

        // Seed a real local session so the poller's localSet() is non-empty
        // (otherwise the claimForSessions call would return [] simply
        // because the SQL WHERE clause matched nothing). This is a
        // sanity-belt, not the test target.
        const dummy = yield* sessions.create({
          title: "local dummy",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* messaging.registerLocal(dummy.id)

        // Target a session ID that is NOT in the local set. The poller will
        // pass [dummy.id, ...others] to claimForSessions, but this row's
        // target_session_id is not in that list — so the WHERE filter drops
        // it and the row stays with drained_at = NULL.
        const remote = SessionID.make("ses_remote_target_xxxxxxxxxx")
        yield* store.insertInbox({
          id: "inb_poller_remote",
          targetSessionID: remote,
          fromSessionID: SessionID.make("ses_remote_sender_xxxxxxxxxx"),
          fromSlug: "remote-peer",
          capsule: capsule("REMOTE-PAYLOAD"),
          timeCreated: 1,
        })

        // The poller should not throw and should not enqueue anything for
        // the remote target.
        yield* poller.pollOnce()

        // No inbox entry was created for `remote` (we never registered a
        // slug for it, and the poller didn't claim the row anyway).
        const remoteInbox = yield* messaging.drain(remote)
        expect(remoteInbox).toEqual([])

        // The row is still claimable: a direct claimForSessions on the
        // target ID (the SQL the poller WOULD have run if the target were
        // local) returns nothing because the ID is not in the local set,
        // but a claimForSessions with the remote target included returns
        // the row — proving the poller left it unclaimed.
        const otherClaimed = yield* store.claimForSessions([remote])
        expect(otherClaimed.map((r) => r.id)).toEqual(["inb_poller_remote"])
      }),
  )

  it.instance(
    "a delivered row is deleted and is NOT redelivered after a reap (M2 regression)",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfgFor)
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const messaging = yield* Messaging.Service
        const store = yield* S2SStore.Service
        const poller = yield* S2SPoller.Service

        // Seed a local idle session — same harness as the first case.
        const chat = yield* sessions.create({
          title: "Reap target",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "warm-up" }],
        })
        yield* llm.text("first-wake-reply")
        yield* messaging.registerLocal(chat.id)
        yield* messaging.registerSlug("reap-target", chat.id)

        // First pollOnce claims the row and (because the session is idle)
        // wakes the loop. After that, the inbox is drained and the row's
        // drained_at is set.
        yield* store.insertInbox({
          id: "inb_reap_1",
          targetSessionID: chat.id,
          fromSessionID: SessionID.make("ses_reap_sender_xxxxxxxxxx"),
          fromSlug: "peer-z",
          capsule: capsule("FIRST-PAYLOAD"),
          timeCreated: 1,
        })
        yield* poller.pollOnce()
        // First wake fired; the inbox is empty.
        expect((yield* messaging.drain(chat.id))).toEqual([])

        // Insert a NEW row and deliver it via pollOnce. processRow enqueues
        // the body AND hard-deletes the row (the M2 fix). Before that fix the
        // row stayed merely claimed (drained_at set), so the reaper below
        // would resurrect it and the body would be delivered TWICE.
        yield* store.insertInbox({
          id: "inb_reap_2",
          targetSessionID: chat.id,
          fromSessionID: SessionID.make("ses_reap_sender_xxxxxxxxxx"),
          fromSlug: "peer-z",
          capsule: capsule("DELIVER-ONCE-PAYLOAD"),
          timeCreated: 1,
        })
        yield* llm.text("deliver-once-wake-reply")
        yield* poller.pollOnce()
        // Delivered once and drained.
        expect((yield* messaging.drain(chat.id))).toEqual([])
        // The row is GONE (deleted, not just claimed): no undelivered rows remain.
        expect(yield* store.countUndelivered(chat.id)).toBe(0)

        // Reap at a far-future cutoff. Before the M2 fix this reset the
        // delivered row's drained_at to NULL and made it re-claimable; now the
        // row no longer exists, so the reaper has nothing to resurrect.
        yield* poller.reapOnce(Date.now() + 10 ** 9)

        // A follow-up pollOnce finds nothing to claim — no re-delivery, no wake.
        yield* poller.pollOnce()

        // The body must appear EXACTLY ONCE in the transcript (the single
        // legitimate delivery). A second occurrence would be the redelivery
        // bug the reaper used to cause.
        const messages = yield* sessions.messages({ sessionID: chat.id })
        const deliveries = messages
          .flatMap((m) => m.parts)
          .filter((p) => p.type === "text" && p.synthetic === false)
          .map((p) => (p.type === "text" ? p.text : ""))
          .filter((t) => t.includes("DELIVER-ONCE-PAYLOAD")).length
        expect(deliveries).toBe(1)
      }),
  )
})
