import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Schema, Stream } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("project"), workspaceID: "workspace" })),
)
const it = testEffect(EventV2.layer.pipe(Layer.provideMerge(locationLayer)))
const itWithoutLocation = testEffect(EventV2.layer)

const Message = EventV2.define({
  type: "test.message",
  schema: {
    text: Schema.String,
  },
})

const GlobalMessage = EventV2.define({
  type: "test.global",
  schema: {
    text: Schema.String,
  },
})

const VersionedMessage = EventV2.define({
  type: "test.versioned",
  version: 2,
  schema: {
    text: Schema.String,
  },
})

describe("EventV2", () => {
  it.effect("publishes events with the current location", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const fiber = yield* events.subscribe(Message).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      const event = yield* events.publish(Message, { text: "hello" })
      const received = Array.from(yield* Fiber.join(fiber))

      expect(received).toEqual([event])
      expect(event.type).toBe("test.message")
      expect(event).not.toHaveProperty("version")
      expect(event.data).toEqual({ text: "hello" })
      expect(event.location).toEqual({ directory: AbsolutePath.make("project"), workspaceID: "workspace" })
    }),
  )

  itWithoutLocation.effect("omits location when no location is available", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const event = yield* events.publish(GlobalMessage, { text: "hello" })

      expect(event).not.toHaveProperty("location")
      expect(event.type).toBe("test.global")
    }),
  )

  it.effect("publishes definition version", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const event = yield* events.publish(VersionedMessage, { text: "hello" })

      expect(event.type).toBe("test.versioned")
      expect(event.version).toBe(2)
    }),
  )

  it.effect("stores definitions in the exported registry", () =>
    Effect.sync(() => {
      expect(EventV2.registry.get(Message.type)).toBe(Message)
    }),
  )

  it.effect("publishes to typed and wildcard subscriptions", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const typed = yield* events.subscribe(Message).pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const wildcard = yield* events.all().pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      const event = yield* events.publish(Message, { text: "hello" })

      expect(Array.from(yield* Fiber.join(typed))).toEqual([event])
      expect(Array.from(yield* Fiber.join(wildcard))).toEqual([event])
    }),
  )

  it.effect("runs sync handlers inline", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const received = new Array<EventV2.Payload>()
      const unsubscribe = yield* events.sync((event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )

      const event = yield* events.publish(Message, { text: "hello" })
      yield* unsubscribe
      yield* events.publish(Message, { text: "after unsubscribe" })

      expect(received).toEqual([event])
    }),
  )

  it.effect("runs sync handlers before publishing to streams", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const received = new Array<string>()
      const fiber = yield* events.all().pipe(
        Stream.take(1),
        Stream.runForEach(() => Effect.sync(() => received.push("stream"))),
        Effect.forkScoped,
      )
      yield* events.sync((event) =>
        Effect.sync(() => {
          received.push(event.type)
        }),
      )

      yield* Effect.yieldNow
      yield* events.publish(Message, { text: "hello" })
      yield* Fiber.join(fiber)

      expect(received).toEqual([Message.type, "stream"])
    }),
  )
})
