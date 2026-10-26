import { describe, expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)
const project = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const other = Location.Ref.make({ directory: AbsolutePath.make("/other") })

describe("Session.list", () => {
  it.effect("pages through the filtered store results in both directions", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      yield* Effect.forEach(["match one", "match two", "match three"], (title) =>
        session.create({ location: project, title }),
      )
      yield* session.create({ location: project, title: "different" })
      yield* session.create({ location: other, title: "match elsewhere" })
      const filter = { directory: project.directory, search: "match", order: "asc" as const }
      const store = yield* SessionStore.Service
      const expected = (yield* store.list(filter)).map((item) => item.id)

      const first = yield* session.list({ ...filter, limit: 2 })
      const second = yield* session.list({ cursor: first.cursor.next, limit: 2 })
      const back = yield* session.list({ cursor: second.cursor.previous, limit: 2 })

      expect(expected).toHaveLength(3)
      expect([...first.data, ...second.data].map((item) => item.id)).toEqual(expected)
      expect(second.cursor.next).toBeUndefined()
      expect(back.data.map((item) => item.id)).toEqual(expected.slice(0, 2))
    }),
  )

  it.effect("offers a cursor in the direction of travel only while more sessions exist", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      yield* Effect.forEach(Array.from({ length: 6 }), () => session.create({ location: project }), { discard: true })
      const filter = { directory: project.directory, order: "asc" as const }
      const store = yield* SessionStore.Service
      const expected = (yield* store.list(filter)).map((item) => item.id)
      const ids = (page: { data: ReadonlyArray<Session.Info> }) => page.data.map((item) => item.id)

      const first = yield* session.list({ ...filter, limit: 2 })
      const second = yield* session.list({ cursor: first.cursor.next, limit: 2 })
      const last = yield* session.list({ cursor: second.cursor.next, limit: 2 })
      const back = yield* session.list({ cursor: last.cursor.previous, limit: 2 })
      const start = yield* session.list({ cursor: back.cursor.previous, limit: 2 })

      expect(expected).toHaveLength(6)
      expect([ids(first), ids(second), ids(last), ids(back), ids(start)]).toEqual([
        expected.slice(0, 2),
        expected.slice(2, 4),
        expected.slice(4, 6),
        expected.slice(2, 4),
        expected.slice(0, 2),
      ])
      expect([first, second, last, back, start].map((page) => [!!page.cursor.previous, !!page.cursor.next])).toEqual([
        [true, true],
        [true, true],
        [true, false],
        [true, true],
        [false, true],
      ])
    }),
  )

  it.effect("returns 50 sessions when no limit is given", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      yield* Effect.forEach(Array.from({ length: 51 }), () => session.create({ location: project }), { discard: true })

      expect((yield* session.list()).data).toHaveLength(50)
    }),
  )

  it.effect("rejects an invalid cursor", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const error = yield* session.list({ cursor: Schema.decodeSync(Session.ListCursor)("invalid") }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(Session.InvalidListCursorError)
    }),
  )
})

describe("Session.family", () => {
  const update = (sessionID: Session.ID, values: Partial<typeof SessionTable.$inferInsert>) =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.db.update(SessionTable).set(values).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
    })

  it.effect("returns the root first, then every descendant by creation time and ID", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const root = yield* session.create({ location: project })
      const first = yield* session.create({ parentID: root.id })
      const second = yield* session.create({ parentID: root.id })
      const grandchild = yield* session.create({ parentID: first.id })
      const fork = yield* session.create({ location: project })
      yield* session.create({ location: project })
      yield* update(fork.id, {
        fork_session_id: root.id,
        fork_boundary: { type: "through", messageID: SessionMessage.ID.make("msg_root") },
      })
      yield* update(root.id, { time_created: 4 })
      // IDs descend with creation, so grandchild.id < second.id < first.id: the tie leaves grandchild before first.
      yield* update(grandchild.id, { time_created: 1 })
      yield* update(first.id, { time_created: 1 })
      yield* update(second.id, { time_created: 2 })
      yield* session.archive(second.id)

      const family = yield* session.family(grandchild.id)

      expect(family.rootID).toBe(root.id)
      expect(family.sessions.map((item) => [item.id, item.status])).toEqual([
        [root.id, "idle"],
        [grandchild.id, "idle"],
        [first.id, "idle"],
        [second.id, "idle"],
      ])
      expect((yield* session.family(root.id)).sessions.map((item) => item.id)).toEqual(
        family.sessions.map((item) => item.id),
      )
    }),
  )

  it.effect("treats the topmost ancestor as root and ends on a parent cycle", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const root = yield* session.create({ location: project })
      const child = yield* session.create({ parentID: root.id })
      const missing = Session.ID.make("ses_missing")

      yield* update(root.id, { parent_id: missing })
      expect((yield* session.family(child.id)).rootID).toBe(root.id)

      yield* update(root.id, { parent_id: child.id })
      expect(yield* session.family(child.id).pipe(Effect.flip)).toBeInstanceOf(Session.NotFoundError)
      expect(yield* session.family(missing).pipe(Effect.flip)).toBeInstanceOf(Session.NotFoundError)
    }),
  )
})
