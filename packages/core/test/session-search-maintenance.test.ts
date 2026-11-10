import type { FileSystem } from "@opencode/core/filesystem"
import { describe, expect } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { Duration, Effect, Layer, LayerMap } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "@opencode/core/bus"
import { Flag } from "@opencode/core/flag"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { LocationServiceMap, type LocationServices } from "@opencode/core/location-services"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionSearchIndex } from "@opencode/core/session/search-index"
import { SessionSearchMaintenance } from "@opencode/core/session/search-maintenance"
import { SessionTable } from "@opencode/core/session/sql"
import { Workspace } from "@opencode/core/workspace"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { testEffect } from "./lib/effect"

// experimental.sqlite_fts per workspace, read by each location's Config when it loads.
const flags = new Map<string, boolean>()

const locations = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const map = yield* LayerMap.make(
      (ref: Location.Ref) =>
        // The maintenance loop only reads flags from a location.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        Layer.mergeAll(
          Flag.testLayer(
            [
              new Document({
                type: "document",
                info: new Info({
                  experimental: new ConfigExperimental.Info({ sqlite_fts: flags.get(ref.workspaceID ?? "") }),
                }),
              }),
            ],
            { app: { channel: "latest" } },
          ),
          Layer.succeed(
            Location.Service,
            Location.Service.of({
              directory: ref.directory,
              workspaceID: ref.workspaceID,
              project: { id: Project.ID.global, directory: ref.directory, canonical: ref.directory },
            }),
          ),
        ).pipe(Layer.fresh) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      { idleTimeToLive: Duration.infinity },
    )
    return {
      ...map,
      get: (ref: Location.Ref) => map.get(LocationServiceMap.canonical(ref)),
      contextEffect: (ref: Location.Ref) => map.contextEffect(LocationServiceMap.canonical(ref)),
      contextEffectOption: (ref: Location.Ref) => map.contextEffectOption(LocationServiceMap.canonical(ref)),
      invalidate: (ref: Location.Ref) => map.invalidate(LocationServiceMap.canonical(ref)),
    }
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, LocationServiceMap.node, SessionSearchMaintenance.node]),
    [
      LocationServiceMap.node.replace(
        makeGlobalNode({ service: LocationServiceMap.Service, layer: locations, deps: [] }),
      ),
    ],
  ),
)

const directory = AbsolutePath.make("/project")
const location = (workspace: string, enabled: boolean) => {
  const workspaceID = Workspace.ID.make(`wrk_${workspace}`)
  flags.set(workspaceID, enabled)
  return Location.Ref.make({ directory, workspaceID })
}

const load = (ref: Location.Ref) =>
  Effect.gen(function* () {
    const map = yield* LocationServiceMap.Service
    yield* Location.Service.pipe(Effect.provide(map.get(ref)), Effect.scoped)
  })

const setup = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: directory, sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  const insert = (id: string, title: string) =>
    db
      .insert(SessionTable)
      .values({ id: Session.ID.make(id), project_id: Project.ID.global, slug: id, directory, title, version: "test" })
      .run()
      .pipe(Effect.orDie)
  yield* insert("ses_old", "Existing walrus history")
  const maintenance = yield* SessionSearchMaintenance.Service
  yield* maintenance.run.pipe(Effect.forkScoped)
  return { db, insert }
})

// Long enough for the idle re-check, the settle pause, and every pause between batches.
const elapse = Effect.repeat(TestClock.adjust("2 seconds"), { times: 20 })

const titles = (db: Database.Interface["db"], query: string) =>
  SessionSearchIndex.search(db, { query }).pipe(Effect.map((hits) => hits.map((hit) => hit.sessionID)))

const triggers = (db: Database.Interface["db"]) =>
  db
    .get<{
      count: number
    }>(sql`SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'session_search_%'`)
    .pipe(Effect.map((row) => row?.count ?? 0))

describe("SessionSearchMaintenance", () => {
  it.effect("does nothing until a location enables it", () =>
    Effect.gen(function* () {
      const { db } = yield* setup
      yield* elapse
      yield* load(location("off_only", false))
      yield* elapse
      expect(yield* triggers(db)).toBe(0)
      expect((yield* SessionSearchIndex.status(db)).version).toBeUndefined()
    }),
  )

  it.effect("backfills existing history in the background and keeps up with new writes", () =>
    Effect.gen(function* () {
      const { db, insert } = yield* setup
      yield* load(location("on", true))
      yield* elapse
      expect(yield* titles(db, "walrus")).toEqual([Session.ID.make("ses_old")])
      expect((yield* SessionSearchIndex.status(db)).backfill).toBe("done")

      yield* insert("ses_new", "Fresh narwhal plans")
      yield* elapse
      expect(yield* titles(db, "narwhal")).toEqual([Session.ID.make("ses_new")])
      expect((yield* SessionSearchIndex.status(db)).pending).toBe(0)
    }),
  )

  it.effect("runs while any loaded location enables it; off stops it and keeps the index", () =>
    Effect.gen(function* () {
      const { db, insert } = yield* setup
      const on = location("mixed_on", true)
      yield* load(on)
      yield* load(location("mixed_off", false))
      yield* elapse
      expect(yield* titles(db, "walrus")).toEqual([Session.ID.make("ses_old")])

      flags.set(on.workspaceID ?? "", false)
      const map = yield* LocationServiceMap.Service
      yield* map.invalidate(on)
      yield* load(on)
      yield* elapse
      // Off leaves the index as it was; writes meanwhile are only queued.
      yield* insert("ses_offline", "Written while the otter index was off")
      yield* elapse
      expect(yield* titles(db, "walrus")).toEqual([Session.ID.make("ses_old")])
      expect(yield* titles(db, "otter")).toEqual([])
      expect((yield* SessionSearchIndex.status(db)).pending).toBe(1)

      // Back on, it catches up from the queue without rebuilding.
      flags.set(on.workspaceID ?? "", true)
      yield* map.invalidate(on)
      yield* load(on)
      yield* elapse
      expect(yield* titles(db, "otter")).toEqual([Session.ID.make("ses_offline")])
      expect((yield* SessionSearchIndex.status(db)).pending).toBe(0)
    }),
  )

  it.effect("backfills only while no session is writing", () =>
    Effect.gen(function* () {
      const { db } = yield* setup
      const bus = yield* Bus.Service
      const write = bus.publish(SessionEvent.Renamed, { sessionID: Session.ID.make("ses_old"), title: "Busy" })
      yield* load(location("busy", true))
      yield* Effect.repeat(write.pipe(Effect.andThen(TestClock.adjust("2 seconds"))), { times: 20 })
      expect(yield* SessionSearchIndex.status(db)).toMatchObject({
        version: SessionSearchIndex.Version,
        backfill: "titles",
      })
      yield* elapse
      expect((yield* SessionSearchIndex.status(db)).backfill).toBe("done")
      expect(yield* titles(db, "walrus")).toEqual([Session.ID.make("ses_old")])
    }),
  )

  it.effect("drops sessions deleted after the backfill", () =>
    Effect.gen(function* () {
      const { db } = yield* setup
      yield* load(location("delete", true))
      yield* elapse
      yield* db
        .delete(SessionTable)
        .where(eq(SessionTable.id, Session.ID.make("ses_old")))
        .run()
        .pipe(Effect.orDie)
      yield* elapse
      expect(yield* titles(db, "walrus")).toEqual([])
    }),
  )
})
