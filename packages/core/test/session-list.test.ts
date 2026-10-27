import { describe, expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { LayerNode } from "@opencode/util/effect/layer-node"
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
      const end = yield* session.list({ cursor: second.cursor.next, limit: 2 })

      expect(expected).toHaveLength(3)
      expect([...first.data, ...second.data].map((item) => item.id)).toEqual(expected)
      expect(back.data.map((item) => item.id)).toEqual(expected.slice(0, 2))
      expect(end).toEqual({ data: [], cursor: { previous: undefined, next: undefined } })
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
