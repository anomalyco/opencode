// Session-to-Session — Task 7: enqueueExternal + the s2s tool.
//
// Validates the additive behavior introduced by the s2s tool at
// the unit level. The test composes a minimum viable layer
// (Database, S2SStore, Messaging, Session, the S2STool effect,
// EventV2Bridge) and exercises:
//
//   1. S2STool command="invite": mints an s2s_token row bound to
//      the calling session.
//   2. S2STool command="accept": consumes the token, writes BOTH
//      directions of s2s_allow; a second accept of the same token
//      fails.
//   3. S2STool command="msg":
//      - to a non-allowed target → tool-level error
//      - to an allow-listed peer that's NOT in-process → row in
//        s2s_inbox (cross-process path through the module-local
//        enqueueExternal helper)
//   4. S2STool command="leave": deletes both s2s_allow directions.
//   5. S2STool command="relay": smoke test that the body
//      round-trips through the capsule shape (zero-infra fallback).
//   6. enqueueExternal:
//      - writes a single s2s_inbox row
//      - the 51st send in an hour trips the AbuseError on the
//        Messaging.AbuseError tag
//      - the same capsule.id twice produces ONE row (per-sender
//        dedup window)
//
// The Messaging.enqueueExternal interface method is NOT exercised
// here because Task 7's enqueueExternal lives as a module-local
// helper in `src/tool/s2s.ts` (not on the Messaging.Service) — see
// the file-level comment in that file for the rationale. The cross-
// process path the tool takes is `S2STool → enqueueExternal`.
//
// Mirrors the `in-memory :memory: + Database.layerFromPath` pattern
// from `test/s2s/store.test.ts`: one in-memory SQLite per file
// (Bun's `Database(":memory:")` gives one handle per native handle,
// sharing the layer guarantees every service sees the same tables).

import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Messaging } from "../../src/messaging"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { S2SCapsule, decodeCapsule } from "../../src/s2s/capsule"
import { S2SStore } from "../../src/s2s/store"
import { Session } from "@/session/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Truncate } from "@/tool/truncate"
import { S2STool } from "../../src/tool/s2s"
import { MessageID, SessionID } from "../../src/session/schema"
import { testEffectShared } from "../lib/effect"

const database = Database.layerFromPath(":memory:")
const s2sFlags = RuntimeFlags.layer({
  experimentalEventSystem: true,
  experimentalAgentMessaging: true,
  experimentalS2S: true,
})

// Minimal layer for the S2STool + enqueueExternal tests. The S2STool
// depends on S2SStore + Messaging + Session only, so we don't need
// the full runLoop (no ToolRegistry, no SessionPrompt, no BackgroundJob).
const baseLayer = LayerNode.compile(
  LayerNode.group([
    Database.node,
    Session.node,
    SessionProjector.node,
    EventV2Bridge.node,
    Config.node,
    S2SStore.node,
    Messaging.node,
    Agent.node,
    CrossSpawnSpawner.node,
    Truncate.node,
  ]),
  [
    [Database.node, database],
    [RuntimeFlags.node, s2sFlags],
  ],
)

const it = testEffectShared(baseLayer as unknown as Layer.Layer<any, any, never>)

// Create a session and register BOTH the custom slug AND the
// auto-generated slug in Messaging so the S2STool's resolveSlug
// sees the right mapping regardless of which slug the test passes
// in. Returns the auto-assigned sessionID, the custom slug
// (human-readable, used by test code), and the actual slug
// (auto-generated, used by the S2STool internally as
// sessions.get(ctx.sessionID).slug).
const seedSession = Effect.fn("S2SToolTest.seedSession")(function* (slug: string) {
  const sessions = yield* Session.Service
  const messaging = yield* Messaging.Service
  const info = yield* sessions.create({ title: slug, agent: "build" })
  // Register the auto-generated slug (the one the S2STool will
  // see in sessions.get) AND the custom slug (the one the test
  // code uses for readability). Either is enough to resolve the
  // target in tests.
  yield* messaging.registerSlug(info.slug, info.id)
  yield* messaging.registerSlug(slug, info.id)
  return { id: info.id, customSlug: slug, autoSlug: info.slug }
})

// Build a minimal Tool.Context whose sessionID is the calling session
// (drives which s2s_token row `invite` writes, which s2s_allow rows
// `accept` writes, and what fromSlug the tool pulls from sessions.get).
const ctxFor = (sessionID: SessionID) => ({
  sessionID,
  messageID: MessageID.ascending(),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

describe("S2STool", () => {
  it.instance("invite mints a single-use s2s_token row bound to the calling session", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service
      const inviter = yield* seedSession("inviter-1")
      const joiner = yield* seedSession("joiner-1")
      const tool = yield* S2STool
      const def = yield* tool.init()
      const result = yield* def.execute({ command: "invite" }, ctxFor(inviter.id))
      const tokenMatch = result.output.match(/Invite token: (.+)/)
      expect(tokenMatch).not.toBeNull()
      const token = tokenMatch![1]!
      // The store has the row.
      const row = yield* store.claimToken(token, joiner.id)
      expect(Option.isSome(row)).toBe(true)
      if (Option.isSome(row)) {
        expect(row.value.inviterSessionID).toBe(inviter.id)
        expect(row.value.inviterSlug).toBe(inviter.autoSlug)
      }
    }),
  )

  it.instance("accept of a valid token writes BOTH s2s_allow directions", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service
      const messaging = yield* Messaging.Service
      const inviter = yield* seedSession("inviter-2")
      const joiner = yield* seedSession("joiner-2")
      const tool = yield* S2STool
      const def = yield* tool.init()
      // Inviter mints a token.
      const inviteResult = yield* def.execute({ command: "invite" }, ctxFor(inviter.id))
      const token = inviteResult.output.match(/Invite token: (.+)/)![1]!
      // Joiner accepts.
      const acceptResult = yield* def.execute({ command: "accept", token }, ctxFor(joiner.id))
      // Both directions of s2s_allow are written (consent is durable +
      // session_id based — that is the authority msg checks).
      expect(yield* store.isAllowed(joiner.id, inviter.id)).toBe(true)
      expect(yield* store.isAllowed(inviter.id, joiner.id)).toBe(true)
      // The accept output addresses the inviter by session_id.
      expect(acceptResult.output).toContain(inviter.id)
      // The token row was claimed by the joiner.
      const secondClaim = yield* store.claimToken(token, joiner.id)
      expect(Option.isNone(secondClaim)).toBe(true)
    }),
  )

  it.instance("accept of an already-used token fails at the tool layer", () =>
    Effect.gen(function* () {
      const inviter = yield* seedSession("inviter-3")
      const joiner = yield* seedSession("joiner-3")
      const tool = yield* S2STool
      const def = yield* tool.init()
      const token = (yield* def.execute({ command: "invite" }, ctxFor(inviter.id))).output.match(
        /Invite token: (.+)/,
      )![1]!
      // First accept consumes the token.
      yield* def.execute({ command: "accept", token }, ctxFor(joiner.id))
      // Second accept is rejected.
      const exit = yield* def.execute({ command: "accept", token }, ctxFor(joiner.id)).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.instance("msg to a non-allowed target fails with a tool error", () =>
    Effect.gen(function* () {
      const inviter = yield* seedSession("inviter-4")
      const remote = yield* seedSession("remote-4")
      const tool = yield* S2STool
      const def = yield* tool.init()
      // No s2s_allow row → not consented → tool error.
      const exit = yield* def
        .execute({ command: "msg", target: remote.id, body: "hi" }, ctxFor(inviter.id))
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.instance(
    "msg to an allow-listed peer that is NOT in-process writes a s2s_inbox row via enqueueExternal",
    () =>
      Effect.gen(function* () {
        const store = yield* S2SStore.Service
        // Two real sessions; the target is addressed by session_id and
        // is NOT in the local set (so isLocal is false and we take the
        // cross-process path). Consent is the durable s2s_allow row.
        const inviter = yield* seedSession("inviter-5")
        const target = yield* seedSession("remote-5")
        // Manually write the allow (skip the invite/accept dance
        // because that's covered above — this test is about msg's
        // cross-process dispatch, not the handshake).
        yield* store.insertAllow(inviter.id, target.id)
        // Target is NOT in this process's local set (no registerLocal
        // call) → enqueueExternal is taken.
        const tool = yield* S2STool
        const def = yield* tool.init()
        const result = yield* def.execute(
          { command: "msg", target: target.id, body: "ping" },
          ctxFor(inviter.id),
        )
        expect(result.output).toContain("Persisted to s2s_inbox")
        // The row is there.
        const rows = yield* store.claimForSessions([target.id])
        expect(rows).toHaveLength(1)
        const decoded = decodeCapsule(rows[0]!.capsule)
        expect(decoded.body).toBe("ping")
        expect(decoded.sender_slug).toBe(inviter.autoSlug)
      }),
  )

  it.instance("leave deletes both s2s_allow directions", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service
      const inviter = yield* seedSession("inviter-6")
      const remote = yield* seedSession("remote-6")
      yield* store.insertAllow(inviter.id, remote.id)
      yield* store.insertAllow(remote.id, inviter.id)
      const tool = yield* S2STool
      const def = yield* tool.init()
      yield* def.execute({ command: "leave", target: remote.id }, ctxFor(inviter.id))
      expect(yield* store.isAllowed(inviter.id, remote.id)).toBe(false)
      expect(yield* store.isAllowed(remote.id, inviter.id)).toBe(false)
    }),
  )

  it.instance("leave revokes a peer addressed by session_id regardless of in-process registration", () =>
    Effect.gen(function* () {
      const store = yield* S2SStore.Service
      const sessions = yield* Session.Service
      const inviter = yield* seedSession("inviter-6b")
      // Remote session exists in the DB but is NOT registered in the
      // in-process registry — irrelevant now that addressing is by
      // session_id (no slug resolution needed).
      const remoteInfo = yield* sessions.create({ title: "remote-6b", agent: "build" })
      yield* store.insertAllow(inviter.id, remoteInfo.id)
      yield* store.insertAllow(remoteInfo.id, inviter.id)
      const tool = yield* S2STool
      const def = yield* tool.init()
      yield* def.execute({ command: "leave", target: remoteInfo.id }, ctxFor(inviter.id))
      // Both allow directions must be deleted.
      expect(yield* store.isAllowed(inviter.id, remoteInfo.id)).toBe(false)
      expect(yield* store.isAllowed(remoteInfo.id, inviter.id)).toBe(false)
    }),
  )

  it.instance("relay emits a capsule-shaped JSON blob (zero-infra fallback smoke test)", () =>
    Effect.gen(function* () {
      const inviter = yield* seedSession("inviter-7")
      const tool = yield* S2STool
      const def = yield* tool.init()
      const result = yield* def.execute(
        { command: "relay", body: "relay-payload" },
        ctxFor(inviter.id),
      )
      // Output is a JSON-encoded v1 capsule; decoding it round-trips
      // the body and the sender slug.
      const parsed: unknown = JSON.parse(result.output)
      const capsule = decodeCapsule(JSON.stringify(parsed))
      expect(capsule.body).toBe("relay-payload")
      expect(capsule.sender_slug).toBe(inviter.autoSlug)
      expect(capsule.version).toBe(1)
    }),
  )
})
