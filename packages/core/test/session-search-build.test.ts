import type { FileSystem } from "@opencode/core/filesystem"
import { describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { Duration, Effect, Fiber, Layer, LayerMap } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { LocationServiceMap, type LocationServices } from "@opencode/core/location-services"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionSearchBuild } from "@opencode/core/session/search-build"
import { SessionSearchIndex } from "@opencode/core/session/search-index"
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
        // The build only reads Config from a location.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        Layer.mergeAll(
          Config.testLayer([
            new Document({
              type: "document",
              info: new Info({
                experimental: new ConfigExperimental.Info({ sqlite_fts: flags.get(ref.workspaceID ?? "") }),
              }),
            }),
          ]),
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
  AppNodeBuilder.build(LayerNode.group([Database.node, LocationServiceMap.node, SessionSearchBuild.node]), [
    LocationServiceMap.node.replace(
      makeGlobalNode({ service: LocationServiceMap.Service, layer: locations, deps: [] }),
    ),
  ]),
)

const directory = AbsolutePath.make("/project")

/** Loads a location whose config sets the flag to `enabled`, or reloads it with a new value. */
const load = (workspace: string, enabled: boolean) =>
  Effect.gen(function* () {
    const workspaceID = Workspace.ID.make(`wrk_${workspace}`)
    const ref = Location.Ref.make({ directory, workspaceID })
    flags.set(workspaceID, enabled)
    const map = yield* LocationServiceMap.Service
    yield* map.invalidate(ref)
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
  yield* Effect.forEach(["ses_a", "ses_b", "ses_c"], (id) => insert(id, `Existing walrus ${id}`))
  const build = yield* SessionSearchBuild.Service
  const fiber = yield* build.run.pipe(Effect.forkScoped)
  return { db, insert, build, fiber }
})

// A real macrotask lets the build's file reads finish before the clock moves past its next sleep.
const step = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1))).pipe(
  Effect.andThen(TestClock.adjust("5 seconds")),
)
/** Long enough for several flag polls, so a no-op assertion afterwards means something. */
const elapse = Effect.repeat(step, { times: 10 })
const until = (condition: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    const deadline = performance.now() + 15_000
    while (!(yield* condition)) {
      if (performance.now() > deadline) return yield* Effect.die(new Error("condition never became true within 15s"))
      yield* step
    }
  })
const settled = (build: SessionSearchBuild.Interface, status: SessionSearchBuild.Status["status"]) =>
  until(build.status.pipe(Effect.map((current) => current.status === status)))

const titles = (db: Database.Interface["db"], query: string) =>
  SessionSearchIndex.search(db, { query }).pipe(
    Effect.map((hits) => hits.map((hit): string => hit.sessionID).toSorted()),
  )

const objects = (db: Database.Interface["db"]) =>
  db.all(sql`SELECT name FROM sqlite_master WHERE name GLOB 'session_search*'`).pipe(Effect.map((rows) => rows.length))

const failOn = (db: Database.Interface["db"], ids: string) =>
  db.run(
    `CREATE TRIGGER fail_queue BEFORE INSERT ON session_search_queue WHEN NEW.source_id IN (${ids}) BEGIN SELECT RAISE(ABORT, 'induced'); END`,
  )

describe("SessionSearchBuild", () => {
  it.effect("does nothing while the flag is off", () =>
    Effect.gen(function* () {
      const { db, build } = yield* setup
      yield* load("off", false)
      yield* elapse
      expect(yield* objects(db)).toBe(0)
      expect(yield* build.status).toEqual({ status: "disabled" })
    }),
  )

  it.effect("builds once a location enables it, records it done and exits; triggers keep it current", () =>
    Effect.gen(function* () {
      const { db, insert, build, fiber } = yield* setup
      yield* load("mixed_off", false)
      yield* load("mixed_on", true)
      yield* settled(build, "completed")
      expect(yield* titles(db, "walrus")).toEqual(["ses_a", "ses_b", "ses_c"])
      expect(yield* build.status).toEqual({ status: "completed", skipped: 0 })
      yield* Fiber.join(fiber)

      // Off stops nothing: the triggers maintain the index without the job.
      yield* load("mixed_on", false)
      yield* insert("ses_d", "Fresh narwhal plans")
      expect(yield* titles(db, "narwhal")).toEqual(["ses_d"])
    }),
  )

  it.effect("skips a row that fails alone; fails when every row does, and retries only once turned off and on", () =>
    Effect.gen(function* () {
      const { db, build } = yield* setup
      yield* SessionSearchIndex.ensure(db)
      yield* failOn(db, "'ses_b'")
      yield* load("flaky", true)
      yield* settled(build, "completed")
      expect(yield* titles(db, "walrus")).toEqual(["ses_a", "ses_c"])
      expect(yield* build.status).toEqual({ status: "completed", skipped: 1 })

      // Built again from the start, every row fails, so the build stops and records why.
      yield* db.run("DROP TRIGGER fail_queue")
      yield* failOn(db, "'ses_a', 'ses_b', 'ses_c'")
      yield* db.run(sql`
        UPDATE kv SET value = json_remove(json_set(value, '$.status', 'building', '$.phase', 'titles', '$.skipped', 0), '$.after')
        WHERE key = 'session.search'
      `)
      const again = yield* build.run.pipe(Effect.forkScoped)
      yield* settled(build, "error")
      expect(yield* SessionSearchIndex.state(db)).toMatchObject({ status: "failed" })

      // Still on, it is not retried.
      yield* db.run("DROP TRIGGER fail_queue")
      yield* elapse
      expect(yield* build.status).toMatchObject({ status: "error" })
      yield* load("flaky", false)
      yield* elapse
      yield* load("flaky", true)
      yield* settled(build, "completed")
      expect(yield* build.status).toEqual({ status: "completed", skipped: 0 })
      expect(yield* titles(db, "walrus")).toEqual(["ses_a", "ses_b", "ses_c"])
      yield* Fiber.join(again)
    }),
  )

  it.effect("pauses while the flag is off and resumes from its cursor", () =>
    Effect.gen(function* () {
      const { db, build } = yield* setup
      yield* SessionSearchIndex.ensure(db)
      expect(yield* SessionSearchIndex.buildChunk(db, { limit: 1 })).toEqual({ done: false })
      expect(yield* build.status).toEqual({
        status: "paused",
        progress: { label: "Indexing session history", numerator: 1, denominator: 3 },
      })
      yield* load("resume", true)
      yield* settled(build, "completed")
      expect(yield* SessionSearchIndex.state(db)).toMatchObject({ status: "done", processed: 3, total: 3 })
    }),
  )
})
