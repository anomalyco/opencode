import { describe, expect } from "bun:test"
import path from "path"
import { Context, Deferred, Effect, Fiber, Layer } from "effect"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionTable } from "@opencode/core/session/sql"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { it } from "./lib/effect"
import { tmpdirScoped } from "./fixture/tmpdir"

const sessionID = SessionSchema.ID.make("ses_inbox_lock")

const fixture = Effect.gen(function* () {
  const context = yield* Layer.build(
    AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionInbox.node, SessionProjector.node])),
  )
  const db = Context.get(context, Database.Service).db
  const bus = Context.get(context, Bus.Service)
  const inbox = Context.get(context, SessionInbox.Service)
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "lock",
      directory: "/project",
      title: "lock",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  yield* inbox.admit({
    id: SessionMessage.ID.create(),
    sessionID,
    item: { type: "user", payload: { text: "Hello" }, delivery: "steer" },
  })
  return { db, bus, inbox }
})

describe("SessionInbox locks", () => {
  it.live("serializes the same session across connections to one database file", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const layer = AppNodeBuilder.build(Database.configured({ path: path.join(tmp.path, "inbox.sqlite") }))
      const first = Context.get(yield* Layer.build(layer), Database.Service).db
      const second = Context.get(yield* Layer.build(layer), Database.Service).db
      expect(first).not.toBe(second)

      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const attempted = yield* Deferred.make<void>()
      const entered = yield* Deferred.make<void>()
      const holder = yield* SessionInbox.serialized(
        first,
        sessionID,
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
      ).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const waiter = yield* Deferred.succeed(attempted, undefined).pipe(
        Effect.andThen(SessionInbox.serialized(second, sessionID, Deferred.succeed(entered, undefined))),
        Effect.forkChild,
      )
      yield* Deferred.await(attempted)
      yield* Effect.yieldNow
      yield* Effect.sync(() => expect(Deferred.isDoneUnsafe(entered)).toBe(false)).pipe(
        Effect.ensuring(Deferred.succeed(release, undefined)),
      )
      yield* Fiber.join(holder)
      yield* Fiber.join(waiter)
      expect(Deferred.isDoneUnsafe(entered)).toBe(true)
    }),
  )

  it.live("promotes the same session ID independently in different databases", () =>
    Effect.gen(function* () {
      const first = yield* fixture
      const second = yield* fixture
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* first.bus.project(SessionEvent.InboxDelivered, () =>
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
      )
      const parked = yield* SessionInbox.promote(first.db, first.bus, sessionID, "steer").pipe(Effect.forkChild)
      yield* Deferred.await(started)

      const promoted = yield* SessionInbox.promote(second.db, second.bus, sessionID, "steer").pipe(
        Effect.timeout("2 seconds"),
        Effect.ensuring(Deferred.succeed(release, undefined)),
      )
      expect(promoted).toBe(1)
      expect(yield* Fiber.join(parked)).toBe(1)
      expect(yield* first.inbox.list(sessionID)).toEqual([])
      expect(yield* second.inbox.list(sessionID)).toEqual([])
    }),
  )

  it.live("serializes promotion of the same session in one database", () =>
    Effect.gen(function* () {
      const state = yield* fixture
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const attempted = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<void>()
      yield* state.bus.project(SessionEvent.InboxDelivered, () =>
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
      )
      const first = yield* SessionInbox.promote(state.db, state.bus, sessionID, "steer").pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const second = yield* Deferred.succeed(attempted, undefined).pipe(
        Effect.andThen(SessionInbox.promote(state.db, state.bus, sessionID, "steer")),
        Effect.tap(() => Deferred.succeed(completed, undefined)),
        Effect.forkChild,
      )
      yield* Deferred.await(attempted)
      yield* Effect.yieldNow
      yield* Effect.sync(() => expect(Deferred.isDoneUnsafe(completed)).toBe(false)).pipe(
        Effect.ensuring(Deferred.succeed(release, undefined)),
      )

      expect(yield* Fiber.join(first)).toBe(1)
      expect(yield* Fiber.join(second)).toBe(0)
      expect(yield* state.inbox.list(sessionID)).toEqual([])
    }),
  )
})
