import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Workspace } from "@opencode/core/workspace"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Event } from "@opencode/schema/event"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { testEffect } from "./lib/effect"

const Message = Bus.ephemeral({ type: "test.overflow.message", schema: { text: Schema.String } })
const Count = Bus.ephemeral({ type: "test.overflow.count", schema: { count: Schema.Number } })
const Durable = SessionEvent.Renamed

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of({
    directory: AbsolutePath.make("/project-a"),
    workspaceID: Workspace.ID.make("wrk_a"),
    project: {
      id: Project.ID.make("prj_test"),
      directory: AbsolutePath.make("/project-a"),
      canonical: AbsolutePath.make("/project-a"),
    },
  }),
)

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node])))
const itWithLocation = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Location.node]), [
    Location.node.replace(locationLayer),
  ]),
)
const itPersisted = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)

describe("Bus subscriber bounds", () => {
  for (const wildcard of [false, true]) {
    it.effect(`fails only a slow ${wildcard ? "wildcard" : "typed"} subscriber`, () =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const slow = wildcard ? bus.subscribe(undefined, { capacity: 1 }) : bus.subscribe(Message, { capacity: 1 })
        const fast = bus.subscribe(Message)
        const gate = yield* Deferred.make<void>()
        const slowFiber = yield* slow.pipe(
          Stream.take(3),
          Stream.runForEach(() => Deferred.await(gate)),
          Effect.exit,
          Effect.forkScoped({ startImmediately: true }),
        )
        const fastFiber = yield* fast.pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)
        yield* Effect.yieldNow

        yield* bus.publish(Message, { text: "one" })
        yield* Effect.yieldNow
        yield* bus.publish(Message, { text: "two" })
        yield* bus.publish(Message, { text: "three" })
        yield* Fiber.join(fastFiber)
        yield* Deferred.succeed(gate, undefined)

        const result = yield* Fiber.join(slowFiber)
        expect(Exit.isFailure(result)).toBeTrue()
        if (Exit.isSuccess(result)) return
        expect(Option.getOrUndefined(Exit.findErrorOption(result))).toBeInstanceOf(Bus.SubscriberOverflowError)

        const next = bus.subscribe(Message)
        const later = yield* next.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
        yield* Effect.yieldNow
        yield* bus.publish(Message, { text: "later" })
        expect((yield* Fiber.join(later)).map((event) => event.data.text)).toEqual(["later"])
      }),
    )
  }

  it.effect("keeps the newest events for a sliding subscriber", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const stream = bus.subscribe(Message, { capacity: 2, overflow: "slide" })
      const gate = yield* Deferred.make<void>()
      const received: string[] = []
      const fiber = yield* stream.pipe(
        Stream.take(3),
        Stream.runForEach((event) =>
          Effect.sync(() => received.push(event.data.text)).pipe(Effect.andThen(Deferred.await(gate))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.yieldNow

      yield* bus.publish(Message, { text: "one" })
      yield* Effect.yieldNow
      for (const text of ["two", "three", "four"]) yield* bus.publish(Message, { text })
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(fiber)

      expect(received).toEqual(["one", "three", "four"])
    }),
  )

  it.effect("times out backpressure instead of blocking an uninterruptible publisher", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const slow = bus.subscribe(Message, { capacity: 1, overflow: "backpressure" })
      const gate = yield* Deferred.make<void>()
      const consumer = yield* slow.pipe(
        Stream.take(3),
        Stream.runForEach(() => Deferred.await(gate)),
        Effect.exit,
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.yieldNow
      yield* bus.publish(Message, { text: "active" })
      yield* Effect.yieldNow
      yield* bus.publish(Message, { text: "queued" })

      const publisher = yield* Effect.uninterruptible(bus.publish(Message, { text: "overflow" })).pipe(
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* TestClock.adjust("5 seconds")
      yield* Fiber.join(publisher)
      yield* Deferred.succeed(gate, undefined)
      expect(Exit.isFailure(yield* Fiber.join(consumer))).toBe(true)
    }),
  )

  it.effect("restarts subscriber consumption after overflow", () =>
    Effect.gen(function* () {
      let runs = 0
      const received: string[] = []
      yield* Bus.restartOnOverflow((onSubscribed) =>
        Stream.unwrap(
          Effect.gen(function* () {
            runs++
            yield* onSubscribed
            return runs === 1
              ? Stream.fail(
                  new Bus.SubscriberOverflowError({
                    capacity: 1,
                    eventID: Event.ID.create(),
                    eventType: Message.type,
                  }),
                )
              : Stream.make("ok")
          }),
        ),
      ).pipe(Stream.runForEach((value) => Effect.sync(() => received.push(value))))
      expect(received).toEqual(["ok"])
      expect(runs).toBe(2)
    }),
  )

  it.effect("reconciles current state and receives later events after overflow", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const gate = yield* Deferred.make<void>()
      const recovered = yield* Deferred.make<string>()
      const later = yield* Deferred.make<void>()
      const received: string[] = []
      let state = "old"
      let registrations = 0
      const consumer = yield* Bus.restartOnOverflow((onSubscribed) =>
        bus.subscribe(Message, {
          capacity: 1,
          overflow: "backpressure",
          onSubscribed: Effect.gen(function* () {
            registrations++
            if (registrations === 2) yield* Deferred.succeed(recovered, state)
            yield* onSubscribed
          }),
        }),
      ).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            received.push(event.data.text)
            if (event.data.text === "later") yield* Deferred.succeed(later, undefined)
            if (received.length <= 2) yield* Deferred.await(gate)
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.yieldNow
      yield* bus.publish(Message, { text: "active" })
      yield* Effect.yieldNow
      yield* bus.publish(Message, { text: "queued" })
      state = "current"

      const publisher = yield* Effect.uninterruptible(bus.publish(Message, { text: "overflow" })).pipe(
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* TestClock.adjust("5 seconds")
      yield* Fiber.join(publisher)
      yield* Deferred.succeed(gate, undefined)
      expect(yield* Deferred.await(recovered)).toBe("current")

      yield* bus.publish(Message, { text: "later" })
      yield* Deferred.await(later)
      expect(received).toEqual(["active", "queued", "later"])
      yield* Fiber.interrupt(consumer)
    }),
  )

  it.effect("keeps events published during overflow recovery", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const consumerGate = yield* Deferred.make<void>()
      const recoveryGate = yield* Deferred.make<void>()
      const inRecovery = yield* Deferred.make<void>()
      const seen = yield* Deferred.make<void>()
      const texts: string[] = []
      let registrations = 0
      const consumer = yield* Bus.restartOnOverflow((onSubscribed) =>
        bus.subscribe(Message, {
          capacity: 1,
          overflow: "backpressure",
          onSubscribed: Effect.gen(function* () {
            registrations++
            if (registrations === 2) {
              yield* Deferred.succeed(inRecovery, undefined)
              yield* Deferred.await(recoveryGate)
            }
            yield* onSubscribed
          }),
        }),
      ).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            texts.push(event.data.text)
            if (event.data.text === "active") yield* Deferred.await(consumerGate)
            if (event.data.text === "during") yield* Deferred.succeed(seen, undefined)
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.yieldNow
      yield* bus.publish(Message, { text: "active" })
      yield* Effect.yieldNow
      yield* bus.publish(Message, { text: "queued" })

      const publisher = yield* Effect.uninterruptible(bus.publish(Message, { text: "overflow" })).pipe(
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* TestClock.adjust("5 seconds")
      yield* Fiber.join(publisher)
      yield* Deferred.succeed(consumerGate, undefined)
      yield* Deferred.await(inRecovery)

      yield* bus.publish(Message, { text: "during" })
      yield* Deferred.succeed(recoveryGate, undefined)
      yield* Deferred.await(seen)
      expect(texts).toContain("during")
      yield* Fiber.interrupt(consumer)
    }),
  )
})
