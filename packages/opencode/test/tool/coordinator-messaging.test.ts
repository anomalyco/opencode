import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Database } from "@opencode-ai/core/database/database"
import { Messaging } from "../../src/messaging"
import { Session } from "@/session/session"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Permission } from "@/permission"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
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
