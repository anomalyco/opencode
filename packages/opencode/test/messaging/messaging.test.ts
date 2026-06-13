import { afterEach, expect } from "bun:test"
import { Effect, Fiber, Layer, Option } from "effect"
import { Messaging } from "../../src/messaging"
import { disposeAllInstances, testInstanceStoreLayer } from "../fixture/fixture"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2Bridge } from "../../src/event-v2-bridge"

const it = testEffect(
  Layer.mergeAll(Messaging.layer.pipe(Layer.provideMerge(EventV2Bridge.defaultLayer)), CrossSpawnSpawner.defaultLayer),
)

const CHILD = SessionID.make("ses_child")
const PARENT = SessionID.make("ses_parent")

afterEach(async () => {
  await disposeAllInstances()
})

it.instance(
  "send/reply - parked child receives the parent's reply",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      const fiber = yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "go left or right?",
          expectReply: true,
          deliver: Effect.void,
        })
        .pipe(Effect.forkScoped)

      yield* Effect.gen(function* () {
        for (;;) {
          if ((yield* messaging.list()).length === 1) return
          yield* Effect.sleep("10 millis")
        }
      }).pipe(Effect.timeout("2 seconds"))

      yield* messaging.reply({ childSessionID: CHILD, body: "left", callerSessionID: PARENT })
      const result = yield* Fiber.join(fiber)
      expect(Option.getOrNull(result)).toBe("left")
    }),
  { git: true },
)

it.instance(
  "send - fire-and-forget returns immediately and parks nothing",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      const result = yield* messaging.send({
        childSessionID: CHILD,
        parentSessionID: PARENT,
        body: "fyi",
        expectReply: false,
        deliver: Effect.void,
      })
      expect(Option.isNone(result)).toBe(true)
      expect((yield* messaging.list()).length).toBe(0)
    }),
  { git: true },
)

it.instance(
  "send - times out when the parent never replies",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      const exit = yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "still there?",
          expectReply: true,
          deliver: Effect.void,
          timeout: "50 millis",
        })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      expect((yield* messaging.list()).length).toBe(0)
    }),
  { git: true },
)

it.instance(
  "reply - a non-parent caller cannot resolve another parent's pending reply",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      const fiber = yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "secret?",
          expectReply: true,
          deliver: Effect.void,
          timeout: "2 seconds",
        })
        .pipe(Effect.forkScoped)
      yield* Effect.sleep("20 millis")
      const exit = yield* messaging
        .reply({ childSessionID: CHILD, body: "intercepted", callerSessionID: SessionID.make("ses_attacker") })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      expect((yield* messaging.list()).length).toBe(1)
      yield* messaging.reply({ childSessionID: CHILD, body: "authorized", callerSessionID: PARENT })
      expect(Option.getOrNull(yield* Fiber.join(fiber))).toBe("authorized")
    }),
  { git: true },
)

it.instance(
  "send - rejects a second in-flight reply for the same child",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "first",
          expectReply: true,
          deliver: Effect.void,
          timeout: "2 seconds",
        })
        .pipe(Effect.forkScoped)
      yield* Effect.sleep("20 millis")
      const exit = yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "second",
          expectReply: true,
          deliver: Effect.void,
        })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  { git: true },
)
