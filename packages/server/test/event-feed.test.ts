import { describe, expect, test } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { EventV2 } from "@opencode-ai/core/event"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { OpenCodeEvent } from "@opencode-ai/protocol/groups/event"
import { DateTime, Deferred, Effect, Exit, Fiber, Option, Schema, Stream } from "effect"
import { it } from "../../core/test/lib/effect"
import { EventFeed } from "../src/event-feed"

const Internal = EventV2.ephemeral({ type: "test.internal", schema: { value: Schema.String } })

const event = (
  id: string,
  location?: { directory: string },
): EventV2.Payload<typeof AgentV2.Event.Updated> => ({
  id: EventV2.ID.make(`evt_${id}`),
  created: DateTime.makeUnsafe(Date.now()),
  type: AgentV2.Event.Updated.type,
  data: {},
  ...(location
    ? {
        location: {
          directory: AbsolutePath.make(location.directory),
        },
      }
    : {}),
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
      const first = yield* feed.subscribe()
      const second = yield* feed.subscribe()
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
      const slow = yield* feed.subscribe()
      const fast = yield* feed.subscribe()
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
      const stream = yield* feed.subscribe()

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
      const current = yield* feed.subscribe()
      const failed = yield* current.pipe(Stream.runCollect, Effect.exit, Effect.forkScoped)

      yield* source.publish(event("bad"))
      const exit = yield* Fiber.join(failed)

      const next = yield* feed.subscribe()
      const received = yield* next.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* source.publish(event("good"))

      expect(Exit.isFailure(exit)).toBeTrue()
      if (Exit.isSuccess(exit)) return
      expect(Option.getOrUndefined(Exit.findErrorOption(exit))).toBeInstanceOf(EventFeed.EncodingError)
      expect(Array.from(yield* Fiber.join(received))).toEqual(["evt_good"])
    }),
  )

  it.effect("delivers location-scoped events only to matching subscribers", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { encode: (event) => event.id })
      const alpha = yield* feed.subscribe({ location: { directory: "/tmp/alpha" } })
      const beta = yield* feed.subscribe({ location: { directory: "/tmp/beta" } })
      const left = yield* alpha.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const right = yield* beta.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)

      yield* source.publish(event("alpha", { directory: "/tmp/alpha" }))
      yield* source.publish(event("beta", { directory: "/tmp/beta" }))

      expect(Array.from(yield* Fiber.join(left))).toEqual(["evt_alpha"])
      expect(Array.from(yield* Fiber.join(right))).toEqual(["evt_beta"])
    }),
  )

  it.effect("keeps the unscoped feed global while scoped subscribers filter", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { encode: (event) => event.id })
      const global = yield* feed.subscribe()
      const scoped = yield* feed.subscribe({ location: { directory: "/tmp/alpha" } })
      const all = yield* global.pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      const only = yield* scoped.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)

      yield* source.publish(event("alpha", { directory: "/tmp/alpha" }))
      yield* source.publish(event("beta", { directory: "/tmp/beta" }))

      expect(Array.from(yield* Fiber.join(all))).toEqual(["evt_alpha", "evt_beta"])
      expect(Array.from(yield* Fiber.join(only))).toEqual(["evt_alpha"])
    }),
  )

  it.effect("encodes once for multiple scoped subscribers that match the same event", () =>
    Effect.gen(function* () {
      let encodes = 0
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        encode: (event) => {
          encodes += 1
          return event.id
        },
      })
      const first = yield* feed.subscribe({ location: { directory: "/tmp/alpha" } })
      const second = yield* feed.subscribe({ location: { directory: "/tmp/alpha" } })
      const left = yield* first.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const right = yield* second.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)

      yield* source.publish(event("shared", { directory: "/tmp/alpha" }))

      expect([Array.from(yield* Fiber.join(left)), Array.from(yield* Fiber.join(right))]).toEqual([
        ["evt_shared"],
        ["evt_shared"],
      ])
      expect(encodes).toBe(1)
    }),
  )

  it.effect("does not encode when no subscriber interest matches", () =>
    Effect.gen(function* () {
      let encodes = 0
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        encode: (event) => {
          encodes += 1
          return event.id
        },
      })
      yield* feed.subscribe({ location: { directory: "/tmp/alpha" } })
      yield* source.publish(event("beta", { directory: "/tmp/beta" }))
      expect(encodes).toBe(0)
    }),
  )

  test("parses location interest from deepObject query params", () => {
    const params = new URLSearchParams()
    params.set("location[directory]", "/tmp/project")
    params.set("location[workspace]", "ws_1")
    expect(EventFeed.interestFromQuery(params)).toEqual({
      location: { directory: "/tmp/project", workspace: "ws_1" },
    })
    expect(EventFeed.interestFromQuery(new URLSearchParams())).toBeUndefined()
  })

  test("parses repeated session interest from query params", () => {
    const params = new URLSearchParams()
    params.append("session", "ses_a")
    params.append("session", "ses_b,ses_c")
    expect(EventFeed.interestFromQuery(params)).toEqual({
      sessions: ["ses_a", "ses_b", "ses_c"],
    })
  })

  test("rejects workspace interest without a directory", () => {
    const params = new URLSearchParams()
    params.set("location[workspace]", "ws_1")
    params.append("session", "ses_a")
    expect(EventFeed.interestFromQuery(params)).toBeUndefined()
  })

  test("matchesInterest delivers global types to location-scoped subscribers", () => {
    expect(
      EventFeed.matchesInterest(
        {
          id: EventV2.ID.make("evt_global"),
          created: DateTime.makeUnsafe(0),
          type: "global.disposed",
          data: {},
        },
        { location: { directory: "/tmp/project" } },
      ),
    ).toBe(true)
  })

  test("matchesInterest rejects workspace mismatches", () => {
    expect(
      EventFeed.matchesInterest(event("ws", { directory: "/tmp/project" }), {
        location: { directory: "/tmp/project", workspace: "ws_other" },
      }),
    ).toBe(false)
  })

  it.effect("delivers session-scoped events only to interested subscribers", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { encode: (event) => event.id })
      const alpha = yield* feed.subscribe({
        location: { directory: "/tmp/project" },
        sessions: ["ses_a"],
      })
      const beta = yield* feed.subscribe({
        location: { directory: "/tmp/project" },
        sessions: ["ses_b"],
      })
      const left = yield* alpha.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const right = yield* beta.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)

      yield* source.publish(sessionEvent("a", "ses_a", { directory: "/tmp/project" }))
      yield* source.publish(sessionEvent("b", "ses_b", { directory: "/tmp/project" }))

      expect(Array.from(yield* Fiber.join(left))).toEqual(["evt_a"])
      expect(Array.from(yield* Fiber.join(right))).toEqual(["evt_b"])
    }),
  )

  it.effect("keeps location-only events flowing when session interest is set", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { encode: (event) => event.id })
      const stream = yield* feed.subscribe({
        location: { directory: "/tmp/project" },
        sessions: ["ses_a"],
      })
      const received = yield* stream.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* source.publish(event("catalog", { directory: "/tmp/project" }))
      expect(Array.from(yield* Fiber.join(received))).toEqual(["evt_catalog"])
    }),
  )

  it.effect("fans out eleven concurrent clients by interest, encoding once per event", () =>
    Effect.gen(function* () {
      let encodes = 0
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        encode: (event) => {
          encodes += 1
          return event.id
        },
      })
      const fibers: Array<Fiber.Fiber<void, EventFeed.Error>> = []
      const counts = Array.from({ length: 11 }, () => 0)
      for (let i = 0; i < 11; i++) {
        const index = i
        // 0-4: disjoint sessions, 5-9: shared session, 10: location-only (overlapping)
        const sessions = index < 5 ? [`ses_${index}`] : index < 10 ? ["ses_shared"] : undefined
        const expected = index < 10 ? 1 : 2
        const stream = yield* feed.subscribe({
          location: { directory: "/tmp/project" },
          ...(sessions ? { sessions } : {}),
        })
        fibers.push(
          yield* stream.pipe(
            Stream.take(expected),
            Stream.runForEach(() => Effect.sync(() => (counts[index] += 1))),
            Effect.forkScoped,
          ),
        )
      }

      for (let i = 0; i < 5; i++) {
        yield* source.publish(sessionEvent(`s${i}`, `ses_${i}`, { directory: "/tmp/project" }))
      }
      yield* source.publish(sessionEvent("shared", "ses_shared", { directory: "/tmp/project" }))

      for (const fiber of fibers) yield* Fiber.join(fiber)

      expect(encodes).toBe(6)
      expect(counts).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2])
      expect(feed.diagnostics().active).toBe(11)
      expect(feed.diagnostics().serializedEvents).toBe(6)
    }),
  )

  it.effect("returns active subscriber count to baseline when scopes close after eleven-client churn", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { encode: (event) => event.id })
      expect(feed.diagnostics()).toMatchObject({ active: 0, opens: 0, closes: 0 })

      yield* Effect.scoped(
        Effect.gen(function* () {
          for (let i = 0; i < 11; i++) yield* feed.subscribe()
          expect(feed.diagnostics().active).toBe(11)
          expect(feed.diagnostics().opens).toBe(11)
          yield* source.publish(event("diag"))
          expect(feed.diagnostics().serializedEvents).toBe(1)
          expect(feed.diagnostics().serializedBytes).toBeGreaterThan(0)
        }),
      )

      expect(feed.diagnostics().active).toBe(0)
      expect(feed.diagnostics().closes).toBe(11)
      const dump = JSON.stringify(feed.diagnostics())
      expect(dump.includes("evt_diag")).toBe(false)
      expect(dump.includes("payload")).toBe(false)
    }),
  )

  it.effect("counts overflows without retaining failed subscriber queues", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        capacity: 1,
        encode: (event) => event.id,
      })
      const slow = yield* feed.subscribe()
      yield* source.publish(event("one"))
      yield* source.publish(event("two"))
      const exit = yield* slow.pipe(Stream.runCollect, Effect.exit)
      expect(Exit.isFailure(exit)).toBeTrue()
      expect(feed.diagnostics().overflows).toBe(1)
      expect(feed.diagnostics().active).toBe(0)
    }),
  )
})

const sessionEvent = (
  id: string,
  sessionID: string,
  location: { directory: string },
): EventV2.Payload => ({
  id: EventV2.ID.make(`evt_${id}`),
  created: DateTime.makeUnsafe(Date.now()),
  type: "session.renamed",
  data: { sessionID, title: id },
  durable: { aggregateID: sessionID, seq: EventV2.Seq.make(1), version: EventV2.Version.make(1) },
  location: {
    directory: AbsolutePath.make(location.directory),
  },
})
