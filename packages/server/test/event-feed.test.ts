import { describe, expect, test } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { EventV2 } from "@opencode-ai/core/event"
import { OpenCodeEvent } from "@opencode-ai/protocol/groups/event"
import { DateTime, Deferred, Effect, Exit, Fiber, Option, Schema, Stream } from "effect"
import { it } from "../../core/test/lib/effect"
import { EventFeed } from "../src/event-feed"

const Internal = EventV2.ephemeral({ type: "test.internal", schema: { value: Schema.String } })

const event = (id: string): EventV2.Payload<typeof AgentV2.Event.Updated> => ({
  id: EventV2.ID.make(`evt_${id}`),
  created: DateTime.makeUnsafe(Date.now()),
  type: AgentV2.Event.Updated.type,
  data: {},
})

const internal = (value: string): EventV2.Payload<typeof Internal> => ({
  id: EventV2.ID.create(),
  created: DateTime.makeUnsafe(Date.now()),
  type: Internal.type,
  data: { value },
})

function makeSource() {
  let subscriber: EventV2.Subscriber | undefined
  return {
    observe: (next: EventV2.Subscriber) =>
      Effect.sync(() => {
        subscriber = next
        return Effect.sync(() => {
          if (subscriber === next) subscriber = undefined
        })
      }),
    publish: (event: EventV2.Payload) => Effect.suspend(() => (subscriber ? subscriber(event) : Effect.void)),
  }
}

describe("EventFeed", () => {
  test("preserves the public SSE frame encoding", () => {
    const payload = event("wire")
    expect(EventFeed.frame(payload)).toBe(
      `data: ${JSON.stringify(Schema.encodeUnknownSync(OpenCodeEvent)(payload))}\n\n`,
    )
  })

  it.effect("encodes once and delivers the same frame to every subscriber", () =>
    Effect.gen(function* () {
      let encodes = 0
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        encode: (event) => {
          encodes += 1
          return event.type
        },
      })
      const first = yield* feed.subscribe
      const second = yield* feed.subscribe
      const left = yield* first.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const right = yield* second.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)

      yield* source.publish(event("example"))

      expect([Array.from(yield* Fiber.join(left)), Array.from(yield* Fiber.join(right))]).toEqual([
        [AgentV2.Event.Updated.type],
        [AgentV2.Event.Updated.type],
      ])
      expect(encodes).toBe(1)
    }),
  )

  it.effect("fails only the subscriber that exceeds its lag capacity", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        capacity: 1,
        encode: (event) => event.id,
      })
      const slow = yield* feed.subscribe
      const fast = yield* feed.subscribe
      const first = yield* Deferred.make<void>()
      const second = yield* Deferred.make<void>()
      const received = new Array<string>()
      const fastFiber = yield* fast.pipe(
        Stream.take(3),
        Stream.runForEach((frame) =>
          Effect.sync(() => received.push(frame)).pipe(
            Effect.andThen(
              frame === "evt_one"
                ? Deferred.succeed(first, undefined)
                : frame === "evt_two"
                  ? Deferred.succeed(second, undefined)
                  : Effect.void,
            ),
          ),
        ),
        Effect.forkScoped,
      )

      yield* source.publish(event("one"))
      yield* Deferred.await(first)
      yield* source.publish(event("two"))
      yield* Deferred.await(second)
      yield* source.publish(event("three"))

      yield* Fiber.join(fastFiber)

      const result = yield* slow.pipe(Stream.runCollect, Effect.exit)
      expect(received).toEqual(["evt_one", "evt_two", "evt_three"])
      expect(Exit.isFailure(result)).toBeTrue()
      if (Exit.isSuccess(result)) return
      expect(Option.getOrUndefined(Exit.findErrorOption(result))).toBeInstanceOf(EventFeed.SubscriberOverflowError)
    }),
  )

  it.effect("filters internal events before they consume subscriber capacity", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { capacity: 1, encode: (event) => event.type })
      const stream = yield* feed.subscribe

      yield* source.publish(internal("one"))
      yield* source.publish(internal("two"))
      yield* source.publish(event("public"))

      expect(Array.from(yield* stream.pipe(Stream.take(1), Stream.runCollect))).toEqual([AgentV2.Event.Updated.type])
    }),
  )

  it.effect("disconnects current subscribers after an encoding failure and continues for later subscribers", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        encode: (event) => {
          if (event.id === EventV2.ID.make("evt_bad")) throw new Error("invalid event")
          return event.id
        },
      })
      const current = yield* feed.subscribe
      const failed = yield* current.pipe(Stream.runCollect, Effect.exit, Effect.forkScoped)

      yield* source.publish(event("bad"))
      const exit = yield* Fiber.join(failed)

      const next = yield* feed.subscribe
      const received = yield* next.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* source.publish(event("good"))

      expect(Exit.isFailure(exit)).toBeTrue()
      if (Exit.isSuccess(exit)) return
      expect(Option.getOrUndefined(Exit.findErrorOption(exit))).toBeInstanceOf(EventFeed.EncodingError)
      expect(Array.from(yield* Fiber.join(received))).toEqual(["evt_good"])
    }),
  )
})
