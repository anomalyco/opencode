import { describe, expect } from "bun:test"
import type { FileSystem } from "@opencode/core/filesystem"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { EventTable } from "@opencode/core/event/sql"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionPresence } from "@opencode/core/session/presence"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionStore } from "@opencode/core/session/store"
import { Effect, Layer, LayerMap } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const locations = Layer.effect(
  LocationServiceMap.Service,
  // Presence tests never drain a Location; only Session.create's canonicalization runs.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  LayerMap.make(() => Layer.empty as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      SessionPresence.node,
    ]),
    [
      LocationServiceMap.node.replace(locations),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      Bus.node.replace(Bus.configured({ persist: true })),
    ],
  ),
)

describe("SessionPresence", () => {
  it.effect("a report creates leases and replaces the client's set", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const presence = yield* SessionPresence.Service
      const one = yield* session.create({ location })
      const two = yield* session.create({ location })

      yield* presence.report({ client: "a", sessions: [one.id, two.id] })
      expect(yield* presence.present(one.id)).toBe(true)
      expect(yield* presence.present(two.id)).toBe(true)

      expect(yield* presence.report({ client: "a", sessions: [one.id] })).toEqual([two.id])
      expect(yield* presence.present(one.id)).toBe(true)
      expect(yield* presence.present(two.id)).toBe(false)
    }),
  )

  it.effect("leases union across clients", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const presence = yield* SessionPresence.Service
      const created = yield* session.create({ location })

      yield* presence.report({ client: "a", sessions: [created.id] })
      yield* presence.report({ client: "b", sessions: [created.id] })
      expect(yield* presence.report({ client: "a", sessions: [] })).toEqual([])
      expect(yield* presence.present(created.id)).toBe(true)

      expect(yield* presence.report({ client: "b", sessions: [] })).toEqual([created.id])
      expect(yield* presence.present(created.id)).toBe(false)
    }),
  )

  it.effect("leases expire after two hours and refresh on report", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const presence = yield* SessionPresence.Service
      const created = yield* session.create({ location })

      yield* presence.report({ client: "a", sessions: [created.id] })
      yield* TestClock.adjust("119 minutes")
      expect(yield* presence.present(created.id)).toBe(true)

      yield* TestClock.adjust("2 minutes")
      expect(yield* presence.present(created.id)).toBe(false)

      yield* presence.report({ client: "a", sessions: [created.id] })
      expect(yield* presence.present(created.id)).toBe(true)
    }),
  )

  it.effect("unknown and archived sessions are ignored", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const presence = yield* SessionPresence.Service
      const missing = Session.ID.make("ses_missing")

      yield* presence.report({ client: "a", sessions: [missing] })
      expect(yield* presence.present(missing)).toBe(false)

      const created = yield* session.create({ location })
      yield* presence.report({ client: "a", sessions: [created.id] })
      expect(yield* presence.present(created.id)).toBe(true)

      yield* session.archive(created.id)
      expect(yield* presence.present(created.id)).toBe(false)
    }),
  )

  it.effect("registration writes no durable events and leaves the inbox empty", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const presence = yield* SessionPresence.Service
      const db = (yield* Database.Service).db
      const created = yield* session.create({ location })
      const before = (yield* db.select().from(EventTable)).length

      yield* presence.report({ client: "a", sessions: [created.id] })

      expect((yield* db.select().from(EventTable)).length).toBe(before)
      expect(yield* session.inbox(created.id)).toEqual([])
    }),
  )
})
