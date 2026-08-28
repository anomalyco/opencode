import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Scope, Stream } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { Event } from "@opencode-ai/schema/event"
import { Permission } from "@opencode-ai/schema/permission"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionID } from "@opencode-ai/schema/session-id"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node])))
const here = Location.Ref.make({ directory: AbsolutePath.make("/observer") })
const elsewhere = Location.Ref.make({ directory: AbsolutePath.make("/publisher") })

describe("Bus.observe", () => {
  it.effect("acquires before consumption and filters exact Session events without Location or owner restrictions", () =>
    Effect.gen(function* () {
      const root = yield* Bus.Service
      const first = Bus.capture(root, Symbol())
      const second = Bus.capture(root, Symbol())
      const sessionID = SessionID.create()
      yield* second.publish(SessionEvent.Renamed, { sessionID, title: "before observation" }, { location: elsewhere })
      const observer = yield* first.observe(sessionID).pipe(Effect.provideService(Location.Service, location(here)))

      yield* second.publish(SessionEvent.Renamed, { sessionID: SessionID.create(), title: "other Session" })
      yield* second.publish(Permission.Event.Asked, {
        id: Permission.ID.create(),
        sessionID,
        action: "read",
        resources: ["file"],
      })
      const renamed = yield* second.publish(
        SessionEvent.Renamed,
        { sessionID, title: "observed" },
        { location: elsewhere },
      )
      const delta = yield* second.publish(
        SessionEvent.Text.Delta,
        {
          sessionID,
          assistantMessageID: SessionMessage.ID.create(),
          ordinal: 0,
          delta: "queued before consumption",
        },
        { location: elsewhere },
      )

      const events = yield* observer.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.provideService(Location.Service, location(here)),
        Effect.provideService(Bus.PrivateOwner, Symbol()),
      )
      expect(Array.from(events)).toEqual([renamed, delta])
      expect(renamed.durable.seq).toBe(Event.Seq.make(1))
      expect(delta).not.toHaveProperty("durable")
    }),
  )

  it.effect("lets consumer callbacks publish to the same aggregate without deadlocking publication", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const sessionID = SessionID.create()
      const observer = yield* bus.observe(sessionID)
      const received: SessionEvent.Event[] = []
      const consumer = yield* observer.pipe(
        Stream.take(2),
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            received.push(event)
            if (event.type === SessionEvent.Renamed.type && event.data.title === "before") {
              yield* bus.publish(SessionEvent.Renamed, { sessionID, title: "after" })
            }
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.publish(SessionEvent.Renamed, { sessionID, title: "before" })
      yield* Fiber.join(consumer)

      expect(received.map((event) => ("durable" in event ? event.durable.seq : undefined))).toEqual([
        Event.Seq.make(0),
        Event.Seq.make(1),
      ])
      expect(
        received.map((event) => (event.type === SessionEvent.Renamed.type ? event.data.title : undefined)),
      ).toEqual(["before", "after"])
    }),
  )

  it.effect("disposes an unconsumed subscription with its acquiring Scope without closing the shared bus", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const sessionID = SessionID.create()
      const owner = yield* Scope.Scope
      const scope = yield* Scope.fork(owner)
      const observer = yield* bus.observe(sessionID).pipe(Scope.provide(scope))
      const survivor = yield* bus.observe(sessionID)
      const before = yield* bus.publish(SessionEvent.Renamed, { sessionID, title: "before disposal" })
      yield* Scope.close(scope, Exit.void)
      const after = yield* bus.publish(SessionEvent.Renamed, { sessionID, title: "after disposal" })

      expect(Array.from(yield* observer.pipe(Stream.runCollect))).toEqual([])
      expect(Array.from(yield* survivor.pipe(Stream.take(2), Stream.runCollect))).toEqual([before, after])
    }),
  )

  it.effect("ends a blocked consumer when the acquiring Scope closes", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const owner = yield* Scope.Scope
      const scope = yield* Scope.fork(owner)
      const observer = yield* bus.observe(SessionID.create()).pipe(Scope.provide(scope))
      const consumer = yield* observer.pipe(Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
      yield* Scope.close(scope, Exit.void)

      expect(Array.from(yield* Fiber.join(consumer))).toEqual([])
    }),
  )
})
