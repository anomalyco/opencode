import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRuntime } from "@opencode-ai/core/session/runtime"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { SessionCreateAdmissionTable, SessionTable } from "@opencode-ai/core/session/sql"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    commit: () => Effect.void,
  }),
)
const projector = SessionProjector.layer.pipe(Layer.provide(events), Layer.provide(database))
const runtime = SessionRuntime.localLayer.pipe(
  Layer.provide(events),
  Layer.provide(database),
  Layer.provide(SessionRunner.noopLayer),
)
const sessions = SessionV2.layer.pipe(Layer.provide(events), Layer.provide(database), Layer.provide(projects), Layer.provide(runtime))
const it = testEffect(Layer.mergeAll(database, events, projects, projector, runtime, sessions))
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const id = SessionV2.ID.create()

describe("SessionV2.create", () => {
  it.effect("creates a fresh projected session when the ID is omitted", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service

      const first = yield* session.create({ location })
      const second = yield* session.create({ location })

      expect(second.id).not.toBe(first.id)
      expect(yield* session.list()).toHaveLength(2)
    }),
  )

  it.effect("returns the original session when the ID is retried", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const input = { id, location }

      const first = yield* session.create(input)
      const retried = yield* session.create(input)

      expect(retried).toEqual(first)
      expect(yield* session.list()).toEqual([first])
    }),
  )

  it.effect("stores supplied immutable create attributes", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const workspaceID = WorkspaceV2.ID.make("wrk_test")
      const model = ModelV2.Ref.make({
        id: ModelV2.ID.make("sonnet"),
        providerID: ProviderV2.ID.anthropic,
        variant: ModelV2.VariantID.make("fast"),
      })

      expect(
        yield* session.create({
          location: Location.Ref.make({ directory: location.directory, workspaceID }),
          agent: AgentV2.ID.make("build"),
          model,
        }),
      ).toMatchObject({ location: { directory: location.directory, workspaceID }, agent: "build", model })
    }),
  )

  it.effect("rejects reuse of one ID with a different immutable create contract", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      yield* session.create({ id, location })
      const changed = [
        { id, location: Location.Ref.make({ directory: AbsolutePath.make("/other") }) },
        { id, location, agent: AgentV2.ID.make("build") },
        {
          id,
          location,
          model: ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic }),
        },
      ]

      for (const input of changed) {
        const failure = yield* session.create(input).pipe(Effect.flip)
        expect(failure._tag).toBe("Session.CreateConflictError")
      }
      expect(yield* session.list()).toHaveLength(1)
    }),
  )

  it.effect("returns one admitted session to concurrent exact retries", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const input = { id, location }

      const admitted = yield* Effect.all([session.create(input), session.create(input)], { concurrency: "unbounded" })

      expect(admitted[1]).toEqual(admitted[0])
      expect(yield* session.list()).toEqual([admitted[0]])
    }),
  )

  it.effect("keeps create admission after the rebuildable projection row is removed", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const input = { id, location }
      const admitted = yield* session.create(input)

      yield* db.delete(SessionTable).where(eq(SessionTable.id, admitted.id)).run().pipe(Effect.orDie)

      expect(yield* session.create(input)).toEqual(admitted)
      expect(yield* db.select().from(SessionCreateAdmissionTable).all().pipe(Effect.orDie)).toHaveLength(1)
      expect(yield* session.list()).toEqual([])
    }),
  )

  it.effect("persists creation through the existing legacy created event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const admitted = yield* session.create({ location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, admitted.id)).all().pipe(Effect.orDie),
      ).toMatchObject([{ type: EventV2.versionedType(SessionLegacy.Event.Created.type, 1) }])
    }),
  )

  it.effect("persists keyed creation admission in replayable event data", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const admitted = yield* session.create({ id, location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, admitted.id)).get().pipe(Effect.orDie),
      ).toMatchObject({
        data: {
          createAdmission: {
            contract: { location },
          },
        },
      })
    }),
  )

  it.effect("does not mask unrelated created projector defects", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const event = yield* EventV2.Service
      const defect = new Error("unrelated projector defect")
      yield* event.project(SessionLegacy.Event.Created, () => Effect.die(defect))

      expect(yield* session.create({ id, location }).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
    }),
  )
})
