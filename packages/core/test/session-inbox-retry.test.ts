import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node])),
)

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const bus = yield* Bus.Service
  const store = yield* SessionStore.Service
  const sessionID = SessionSchema.ID.make("ses_inbox_retry")
  const otherSessionID = SessionSchema.ID.make("ses_inbox_retry_other")
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values(
      [sessionID, otherSessionID].map((id) => ({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: "inbox retry",
        version: "test",
      })),
    )
    .run()
    .pipe(Effect.orDie)

  const publishEntered = yield* Deferred.make<void>()
  const publishRelease = yield* Deferred.make<void>()
  const gate = { first: true }
  // One Inbox instance handles every admission. Only its first enqueue pauses after reconciliation;
  // all writes and promotions still run through the real Bus and SQLite projectors.
  const gatedBus = Bus.Service.of({
    ...bus,
    publish: (definition, data, options) =>
      Effect.gen(function* () {
        if (definition.type === SessionEvent.InboxEnqueued.type && gate.first) {
          gate.first = false
          yield* Deferred.succeed(publishEntered, undefined)
          yield* Deferred.await(publishRelease)
        }
        return yield* bus.publish(definition, data, options)
      }),
  })
  const inbox = yield* SessionInbox.make().pipe(Effect.provideService(Bus.Service, gatedBus))
  return { db, bus: gatedBus, store, inbox, sessionID, otherSessionID, publishEntered, publishRelease }
})

for (const promoted of [false, true]) {
  for (const type of ["user", "synthetic"] as const) {
    it.effect(
      `returns the first ${type} admission to a concurrent retry ${promoted ? "after promotion" : "while pending"}`,
      () =>
        Effect.gen(function* () {
          const fixture = yield* setup
          const id = SessionMessage.ID.create()
          const retry = {
            id,
            sessionID: fixture.sessionID,
            item: {
              type,
              payload: { text: "Retried payload", metadata: { source: "retry" } },
              delivery: "queue" as const,
            },
          }
          const delayed = yield* fixture.inbox
            .admit(retry)
            .pipe(Effect.exit, Effect.forkScoped({ startImmediately: true }))
          yield* Deferred.await(fixture.publishEntered)
          const first = yield* fixture.inbox.admit({
            ...retry,
            item: {
              type,
              payload: { text: "First admission wins", metadata: { source: "winner" } },
              delivery: "steer",
            },
          })
          if (promoted) {
            expect(yield* SessionInbox.promote(fixture.db, fixture.bus, fixture.sessionID, "steer")).toBe(1)
            // A sequential retry must agree with the concurrent retry that is still waiting to publish.
            expect(yield* fixture.inbox.admit(retry)).toMatchObject({ id, type, payload: first.payload })
          }
          yield* Deferred.succeed(fixture.publishRelease, undefined)
          const result = yield* Fiber.join(delayed)

          expect(Exit.isSuccess(result)).toBe(true)
          if (Exit.isSuccess(result)) expect(result.value).toMatchObject({ id, type, payload: first.payload })
          const pending = yield* SessionInbox.list(fixture.db, fixture.sessionID)
          const messages = yield* fixture.store.messages({ sessionID: fixture.sessionID })
          expect(pending).toHaveLength(promoted ? 0 : 1)
          expect(messages).toHaveLength(promoted ? 1 : 0)
          if (!promoted) expect(pending[0]).toMatchObject({ payload: first.payload, delivery: "steer" })
          if (promoted)
            expect(messages[0]).toMatchObject({ type, text: "First admission wins", metadata: { source: "winner" } })
        }),
    )
  }

  for (const conflict of ["Session", "type"] as const) {
    it.effect(
      `rejects cross-${conflict} ID reuse in a concurrent retry ${promoted ? "after promotion" : "while pending"}`,
      () =>
        Effect.gen(function* () {
          const fixture = yield* setup
          const id = SessionMessage.ID.create()
          const delayed = yield* fixture.inbox
            .admit({
              id,
              sessionID: fixture.sessionID,
              item: { type: "synthetic", payload: { text: "Rejected retry" }, delivery: "steer" },
            })
            .pipe(Effect.exit, Effect.forkScoped({ startImmediately: true }))
          yield* Deferred.await(fixture.publishEntered)
          const winnerSessionID = conflict === "Session" ? fixture.otherSessionID : fixture.sessionID
          const first = yield* fixture.inbox.admit({
            id,
            sessionID: winnerSessionID,
            item: {
              type: conflict === "type" ? "user" : "synthetic",
              payload: { text: "Accepted winner" },
              delivery: "steer",
            },
          })
          if (promoted) expect(yield* SessionInbox.promote(fixture.db, fixture.bus, winnerSessionID, "steer")).toBe(1)
          yield* Deferred.succeed(fixture.publishRelease, undefined)
          const result = yield* Fiber.join(delayed)

          expect(Exit.isFailure(result)).toBe(true)
          if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toBeInstanceOf(SessionInbox.LifecycleConflict)
          expect(
            yield* fixture.inbox.reconcile({ id, sessionID: winnerSessionID, type: first.type, delivery: "steer" }),
          ).toMatchObject({ id, sessionID: winnerSessionID, payload: first.payload })
          expect(yield* SessionInbox.list(fixture.db, winnerSessionID)).toHaveLength(promoted ? 0 : 1)
          expect(yield* fixture.store.messages({ sessionID: winnerSessionID })).toHaveLength(promoted ? 1 : 0)
          if (conflict === "Session") {
            expect(yield* SessionInbox.list(fixture.db, fixture.sessionID)).toEqual([])
            expect(yield* fixture.store.messages({ sessionID: fixture.sessionID })).toEqual([])
          }
        }),
    )
  }
}
