import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Messaging } from "../../src/messaging"
import { pollOnceImpl } from "../../src/s2s/poller"
import { S2SStore } from "../../src/s2s/store"
import { SessionID } from "../../src/session/schema"
import { encodeCapsule } from "../../src/s2s/capsule"
import { testEffectIsolatedShared } from "../lib/effect"

const target = SessionID.make("ses_retry_target_xxxxxxxxxxxx")
const sender = SessionID.make("ses_retry_sender_xxxxxxxxxxxx")
let attempts = 0
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
