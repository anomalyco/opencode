import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Stream } from "effect"
import { eq } from "drizzle-orm"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { Event } from "@opencode-ai/schema/event"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { SessionID } from "@opencode-ai/schema/session-id"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { WorkspaceID } from "@opencode-ai/schema/workspace-id"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node]), [
    [Bus.node, Bus.configured({ persist: true })],
  ]),
)
const a = Location.Ref.make({ directory: AbsolutePath.make("/a") })
const b = Location.Ref.make({ directory: AbsolutePath.make("/b") })
const otherWorkspace = Location.Ref.make({ directory: a.directory, workspaceID: WorkspaceID.make("wrk_other") })
const id = SessionID.make("ses_routing")
const Done = Bus.ephemeral({ type: "test.routing.done", schema: {} })
const Global = Bus.ephemeral({ type: "test.routing.global", schema: { sessionID: SessionID } })

const seed = Effect.fn(function* (ref: Location.Ref = a) {
  const database = yield* Database.Service
  yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: a.directory, sandboxes: [] }).run()
  yield* database.db
    .insert(SessionTable)
    .values({
      id,
      project_id: Project.ID.global,
      directory: ref.directory,
      workspace_id: ref.workspaceID,
      slug: "routing",
      version: "test",
    })
    .run()
})

const watch = (bus: Bus.Interface, ref?: Location.Ref, gate?: Deferred.Deferred<void>) => {
  const collect = bus.subscribe().pipe(
    Stream.takeUntil((event) => event.type === Done.type),
    Stream.mapEffect((event) => (gate ? Deferred.await(gate).pipe(Effect.as(event)) : Effect.succeed(event))),
    Stream.runCollect,
  )
  return (ref ? collect.pipe(Effect.provideService(Location.Service, location(ref))) : collect).pipe(
    Effect.forkScoped({ startImmediately: true }),
  )
}

const delta = (bus: Bus.Interface) =>
  bus.publish(SessionEvent.Text.Delta, {
    sessionID: id,
    assistantMessageID: SessionMessage.ID.make("msg_routing"),
    ordinal: 0,
    delta: "text",
  })

describe("Bus Session routing", () => {
  it.effect("delivers workspace-only moves to both owners without duplicating same-location moves", () =>
    Effect.gen(function* () {
      yield* seed()
      const bus = yield* Bus.Service
      const first = yield* watch(bus, a)
      const second = yield* watch(bus, otherWorkspace)
      const moved = yield* bus.publish(
        SessionEvent.Moved,
        { sessionID: id, location: otherWorkspace, projectID: Project.ID.global },
        { location: a },
      )
      const after = yield* delta(bus)
      const same = yield* bus.publish(SessionEvent.Moved, {
        sessionID: id,
        location: otherWorkspace,
        projectID: Project.ID.global,
      })
      const done = yield* bus.publish(Done, {})
      expect(yield* Fiber.join(first)).toEqual([moved, done])
      expect(yield* Fiber.join(second)).toEqual([moved, after, same, done])
      expect(moved.location).toEqual(a)
    }),
  )

  it.effect("routes forks through their parent before the child exists", () =>
    Effect.gen(function* () {
      yield* seed()
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      yield* bus.publish(SessionEvent.Synthetic, { sessionID: id, text: "Fork boundary" })
      const boundary = yield* database.db
        .select({ id: SessionMessageTable.id })
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, id))
        .get()
      if (!boundary) return yield* Effect.die("Missing fork boundary")

      yield* Effect.forEach(["publish", "batch", "replay"] as const, (mode) =>
        Effect.gen(function* () {
          const child = SessionID.create()
          const first = yield* watch(bus, a)
          const second = yield* watch(bus, b)
          const payload = {
            sessionID: child,
            parentID: id,
            boundary: { type: "before" as const, messageID: boundary.id },
          }
          const eventID = Event.ID.create()
          if (mode === "publish") yield* bus.publish(SessionEvent.Forked, payload, { id: eventID })
          if (mode === "batch") yield* bus.publishAll([[SessionEvent.Forked, payload, { id: eventID }]])
          if (mode === "replay")
            yield* bus.replay(
              {
                id: eventID,
                type: Bus.versionedType(SessionEvent.Forked.type, 2),
                seq: 0,
                aggregateID: child,
                data: payload,
              },
              { publish: true },
            )
          const after = yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: child })
          const done = yield* bus.publish(Done, {})
          expect((yield* Fiber.join(first)).map((event) => event.id)).toEqual([eventID, after.id, done.id])
          expect(yield* Fiber.join(second)).toEqual([done])
        }),
      )
    }),
  )

  it.effect("routes existing Sessions without changing public events or global delivery", () =>
    Effect.gen(function* () {
      yield* seed()
      const bus = yield* Bus.Service
      const first = yield* watch(bus, a)
      const second = yield* watch(bus, b)
      const workspace = yield* watch(bus, otherWorkspace)
      const global = yield* watch(bus)
      const listened: Event.Payload[] = []
      yield* bus.listen((event) =>
        Effect.sync(() => {
          listened.push(event)
        }),
      )

      const renamed = yield* bus.publish(SessionEvent.Renamed, { sessionID: id, title: "first" })
      const text = yield* delta(bus)
      const broadcast = yield* bus.publish(Global, { sessionID: id })
      const explicit = yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: id }, { location: b })
      const done = yield* bus.publish(Done, {})

      expect(yield* Fiber.join(first)).toEqual([renamed, text, broadcast, done])
      expect(yield* Fiber.join(second)).toEqual([broadcast, explicit, done])
      expect(yield* Fiber.join(workspace)).toEqual([broadcast, done])
      expect(yield* Fiber.join(global)).toEqual([renamed, text, broadcast, explicit, done])
      expect(listened).toEqual([renamed, text, broadcast, explicit, done])
      expect(renamed).not.toHaveProperty("location")
      expect(text).not.toHaveProperty("location")
      expect(JSON.parse(JSON.stringify(renamed))).not.toHaveProperty("location")
      const history = yield* bus.log({ aggregateID: id }).pipe(Stream.runCollect)
      expect(
        history.filter((event): event is Event.Payload => !Bus.isSynced(event)).every((event) => !event.location),
      ).toBe(true)
    }),
  )

  it.effect("applies the same routing to typed and multi-type subscriptions", () =>
    Effect.gen(function* () {
      yield* seed()
      const bus = yield* Bus.Service
      const typed = yield* bus
        .subscribe(SessionEvent.Renamed)
        .pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.provideService(Location.Service, location(b)),
          Effect.forkScoped({ startImmediately: true }),
        )
      const multiple = yield* bus.subscribe([SessionEvent.Renamed, Done]).pipe(
        Stream.takeUntil((event) => event.type === Done.type),
        Stream.runCollect,
        Effect.provideService(Location.Service, location(b)),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.publish(SessionEvent.Renamed, { sessionID: id, title: "wrong location" })
      yield* bus.publish(SessionEvent.Moved, { sessionID: id, location: b, projectID: Project.ID.global })
      const expected = yield* bus.publish(SessionEvent.Renamed, { sessionID: id, title: "destination" })
      const done = yield* bus.publish(Done, {})
      expect(yield* Fiber.join(typed)).toEqual([expected])
      expect(yield* Fiber.join(multiple)).toEqual([expected, done])
    }),
  )

  it.effect("snapshots routing across creation and moves for slow subscribers", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: a.directory, sandboxes: [] })
        .run()
      const bus = yield* Bus.Service
      const gate = yield* Deferred.make<void>()
      const first = yield* watch(bus, a, gate)
      const second = yield* watch(bus, b, gate)
      const created = yield* bus.publish(SessionEvent.Created, {
        sessionID: id,
        location: a,
        projectID: Project.ID.global,
        slug: "routing",
        version: "test",
      })
      const before = yield* bus.publish(SessionEvent.Renamed, { sessionID: id, title: "before" })
      const moved = yield* bus.publish(SessionEvent.Moved, { sessionID: id, location: b, projectID: Project.ID.global })
      const after = yield* delta(bus)
      const done = yield* bus.publish(Done, {})
      yield* Deferred.succeed(gate, undefined)

      expect(yield* Fiber.join(first)).toEqual([created, before, moved, done])
      expect(yield* Fiber.join(second)).toEqual([moved, after, done])
      expect(moved).not.toHaveProperty("location")
    }),
  )

  it.effect("routes a cold Session deletion before its projector removes ownership", () =>
    Effect.gen(function* () {
      yield* seed()
      const bus = yield* Bus.Service
      const first = yield* watch(bus, a)
      const second = yield* watch(bus, b)
      const global = yield* watch(bus)
      const deleted = yield* bus.publish(SessionEvent.Deleted, { sessionID: id })
      const missing = yield* delta(bus)
      const done = yield* bus.publish(Done, {})

      const database = yield* Database.Service
      expect(yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, id)).get()).toBeUndefined()
      expect(yield* Fiber.join(first)).toEqual([deleted, done])
      expect(yield* Fiber.join(second)).toEqual([done])
      expect(yield* Fiber.join(global)).toEqual([deleted, missing, done])
    }),
  )

  it.effect("preserves routing through a batch that moves and deletes a Session", () =>
    Effect.gen(function* () {
      yield* seed()
      const bus = yield* Bus.Service
      const gate = yield* Deferred.make<void>()
      const first = yield* watch(bus, a, gate)
      const second = yield* watch(bus, b, gate)
      const events = yield* bus.publishAll([
        [SessionEvent.Renamed, { sessionID: id, title: "before" }],
        [SessionEvent.Moved, { sessionID: id, location: b, projectID: Project.ID.global }],
        [SessionEvent.Renamed, { sessionID: id, title: "after" }],
        [SessionEvent.Deleted, { sessionID: id }],
      ])
      const done = yield* bus.publish(Done, {})
      yield* Deferred.succeed(gate, undefined)
      expect(yield* Fiber.join(first)).toEqual([events[0], events[1], done])
      expect(yield* Fiber.join(second)).toEqual([events[1], events[2], events[3], done])
    }),
  )

  it.effect("does not change ownership when single or batched moves roll back", () =>
    Effect.gen(function* () {
      yield* seed()
      const bus = yield* Bus.Service
      const first = yield* watch(bus, a)
      const second = yield* watch(bus, b)
      const before = yield* delta(bus)
      const single = yield* bus
        .publish(
          SessionEvent.Moved,
          { sessionID: id, location: b, projectID: Project.ID.global },
          { commit: () => Effect.die("rollback") },
        )
        .pipe(Effect.exit)
      const batch = yield* bus
        .publishAll([
          [SessionEvent.Moved, { sessionID: id, location: b, projectID: Project.ID.global }],
          [SessionEvent.Renamed, { sessionID: id, title: "rollback" }, { commit: () => Effect.die("rollback") }],
        ])
        .pipe(Effect.exit)
      const after = yield* delta(bus)
      const done = yield* bus.publish(Done, {})
      expect(Exit.isFailure(single)).toBe(true)
      expect(Exit.isFailure(batch)).toBe(true)
      expect(yield* Fiber.join(first)).toEqual([before, after, done])
      expect(yield* Fiber.join(second)).toEqual([done])
    }),
  )

  it.effect("updates cached ownership on silent replay and filters published replay", () =>
    Effect.gen(function* () {
      yield* seed()
      const bus = yield* Bus.Service
      yield* delta(bus)
      const first = yield* watch(bus, a)
      const second = yield* watch(bus, b)
      yield* bus.replay({
        id: Event.ID.create(),
        type: Bus.versionedType(SessionEvent.Moved.type, 1),
        seq: 0,
        aggregateID: id,
        data: { sessionID: id, location: b, projectID: Project.ID.global },
      })
      const after = yield* delta(bus)
      const replayID = Event.ID.create()
      yield* bus.replay(
        {
          id: replayID,
          type: Bus.versionedType(SessionEvent.Renamed.type, 1),
          seq: 1,
          aggregateID: id,
          data: { sessionID: id, title: "replayed" },
        },
        { publish: true },
      )
      const done = yield* bus.publish(Done, {})
      expect(yield* Fiber.join(first)).toEqual([done])
      const received = yield* Fiber.join(second)
      expect(received.map((event) => event.id)).toEqual([after.id, replayID, done.id])
      expect(received[1]).not.toHaveProperty("location")
    }),
  )
})
