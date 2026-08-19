import { expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Messaging } from "../../src/messaging"
import { pollOnceImpl } from "../../src/s2s/poller"
import { S2SStore } from "../../src/s2s/store"
import { SessionID } from "../../src/session/schema"
import { Session } from "../../src/session/session"
import { SessionStatus } from "../../src/session/status"
import { SessionPrompt } from "../../src/session/prompt"
import { encodeCapsule } from "../../src/s2s/capsule"
import { testEffectIsolatedShared } from "../lib/effect"

const target = SessionID.make("ses_retry_target_xxxxxxxxxxxx")
const sender = SessionID.make("ses_retry_sender_xxxxxxxxxxxx")
let attempts = 0
let enqueueResults: boolean[] = []
const capsule = encodeCapsule({
  version: 1,
  id: "0190abcd-7abc-7abc-8abc-0190abcdef01",
  sender_slug: "retry-peer",
  sender_session_id: String(sender),
  timestamp: 1_700_000_000_000,
  body: "BOUNDED-RETRY-PAYLOAD",
})

const it = testEffectIsolatedShared(
  Layer.mergeAll(
    S2SStore.defaultLayer,
    Layer.succeed(SessionStatus.Service, {
      get: () => Effect.succeed({ type: "busy" as const }),
      list: () => Effect.succeed(new Map()),
      set: () => Effect.succeed(undefined),
    }),
    Layer.succeed(Session.Service, {
      findMessage: () => Effect.succeed(Option.none()),
    } as unknown as Session.Interface),
    Layer.succeed(SessionPrompt.Service, {
      loop: () => Effect.die("unexpected SessionPrompt.loop"),
    } as unknown as SessionPrompt.Interface),
    Layer.succeed(Messaging.Service, {
      send: () => Effect.die("unexpected Messaging.send"),
      reply: () => Effect.die("unexpected Messaging.reply"),
      reject: () => Effect.die("unexpected Messaging.reject"),
      list: () => Effect.die("unexpected Messaging.list"),
      registerSlug: () => Effect.die("unexpected Messaging.registerSlug"),
      resolveSlug: () => Effect.die("unexpected Messaging.resolveSlug"),
      setAllow: () => Effect.die("unexpected Messaging.setAllow"),
      getAllow: () => Effect.die("unexpected Messaging.getAllow"),
      slugFor: () => Effect.die("unexpected Messaging.slugFor"),
      enqueue: () => {
        attempts++
        if (enqueueResults.shift() === true) return Effect.succeed(undefined)
        return Effect.fail(new Messaging.AbuseError({ detail: "deterministic test failure" }))
      },
      drain: () => Effect.die("unexpected Messaging.drain"),
      awaitInbox: () => Effect.die("unexpected Messaging.awaitInbox"),
      registerLocal: () => Effect.die("unexpected Messaging.registerLocal"),
      isLocal: () => Effect.die("unexpected Messaging.isLocal"),
      localSet: () => Effect.succeed([target]),
    }),
  ).pipe(Layer.provide(Database.layerFromPath(":memory:"))),
)

it.instance("stops retrying a deterministically failing row within the process lifetime", () =>
  Effect.gen(function* () {
    const store = yield* S2SStore.Service
    attempts = 0
    enqueueResults = []
    yield* store.insertInbox({
      id: "inb_bounded_retry",
      targetSessionID: target,
      fromSessionID: sender,
      fromSlug: "retry-peer",
      capsule,
      timeCreated: 1,
    })

    for (let i = 0; i < 6; i++) {
      yield* (pollOnceImpl() as unknown as Effect.Effect<void, S2SStore.S2SStoreError>)
      yield* store.reapStale(Date.now() + 10 ** 9)
    }

    expect(attempts).toBeLessThan(6)
    expect(attempts).toBeGreaterThan(0)
  }),
)

it.instance("bounds failure tracking across distinct failing rows", () =>
  Effect.gen(function* () {
    const store = yield* S2SStore.Service
    attempts = 0
    enqueueResults = []

    for (let i = 0; i < 501; i++) {
      yield* store.insertInbox({
        id: `inb_bounded_retry_${i}`,
        targetSessionID: target,
        fromSessionID: sender,
        fromSlug: "retry-peer",
        capsule,
        timeCreated: i + 1,
      })
    }

    for (let i = 0; i < 4; i++) {
      yield* (pollOnceImpl() as unknown as Effect.Effect<void, S2SStore.S2SStoreError>)
      yield* store.reapStale(Date.now() + 10 ** 9)
    }

    expect(attempts).toBe(501 * 4)
  }),
)

it.instance("clears a row failure count after successful delivery", () =>
  Effect.gen(function* () {
    const store = yield* S2SStore.Service
    attempts = 0
    enqueueResults = [false, false, true, false, false]

    yield* store.insertInbox({
      id: "inb_retry_success_then_reuse",
      targetSessionID: target,
      fromSessionID: sender,
      fromSlug: "retry-peer",
      capsule,
      timeCreated: 1,
    })

    for (let i = 0; i < 3; i++) {
      yield* (pollOnceImpl() as unknown as Effect.Effect<void, S2SStore.S2SStoreError>)
      yield* store.reapStale(Date.now() + 10 ** 9)
    }

    yield* store.insertInbox({
      id: "inb_retry_success_then_reuse",
      targetSessionID: target,
      fromSessionID: sender,
      fromSlug: "retry-peer",
      capsule,
      timeCreated: 2,
    })

    for (let i = 0; i < 2; i++) {
      yield* (pollOnceImpl() as unknown as Effect.Effect<void, S2SStore.S2SStoreError>)
      yield* store.reapStale(Date.now() + 10 ** 9)
    }

    expect(attempts).toBe(5)
  }),
)
