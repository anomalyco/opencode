import { describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect, Exit, Scope } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionSearchBuild } from "@opencode/core/session/search-build"
import { SessionSearchIndex } from "@opencode/core/session/search-index"
import { SessionTable } from "@opencode/core/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionSearchBuild.node])))

const directory = AbsolutePath.make("/project")

/** Holds the build, as a location with the flag on does, until the returned scope closes. */
const hold = (build: SessionSearchBuild.Interface) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* build.hold.pipe(Scope.provide(scope))
    return scope
  })
const release = (scope: Scope.Closeable) => Scope.close(scope, Exit.void)

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
  yield* build.run.pipe(Effect.forkScoped)
  return { db, insert, build }
})

const step = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1))).pipe(
  Effect.andThen(TestClock.adjust("1 second")),
)
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
  it.effect("does nothing until held", () =>
    Effect.gen(function* () {
      const { db, build } = yield* setup
      yield* elapse
      expect(yield* objects(db)).toBe(0)
      expect(yield* build.status).toEqual({ status: "disabled" })
    }),
  )

  it.effect("builds while held, records it done; triggers keep it current after release", () =>
    Effect.gen(function* () {
      const { db, insert, build } = yield* setup
      const first = yield* hold(build)
      const second = yield* hold(build)
      yield* settled(build, "completed")
      expect(yield* titles(db, "walrus")).toEqual(["ses_a", "ses_b", "ses_c"])
      expect(yield* build.status).toEqual({ status: "completed", skipped: 0 })

      // Off stops nothing: the triggers maintain the index without the build.
      yield* release(first)
      yield* release(second)
      yield* insert("ses_d", "Fresh narwhal plans")
      expect(yield* titles(db, "narwhal")).toEqual(["ses_d"])
    }),
  )

  it.effect("skips a row that fails alone; fails when every row does, and retries only once released and held", () =>
    Effect.gen(function* () {
      const { db, build } = yield* setup
      yield* SessionSearchIndex.ensure(db)
      yield* failOn(db, "'ses_b'")
      const flaky = yield* hold(build)
      yield* settled(build, "completed")
      expect(yield* titles(db, "walrus")).toEqual(["ses_a", "ses_c"])
      expect(yield* build.status).toEqual({ status: "completed", skipped: 1 })
      yield* release(flaky)

      // Built again from the start, every row fails, so the build stops and records why.
      yield* db.run("DROP TRIGGER fail_queue")
      yield* failOn(db, "'ses_a', 'ses_b', 'ses_c'")
      yield* db.run(sql`
        UPDATE kv SET value = json_remove(json_set(value, '$.status', 'building', '$.phase', 'titles', '$.skipped', 0), '$.after')
        WHERE key = 'session.search'
      `)
      const again = yield* hold(build)
      yield* settled(build, "error")
      expect(yield* SessionSearchIndex.state(db)).toMatchObject({ status: "failed" })

      // Still held, it is not retried; released and held again, it is.
      yield* db.run("DROP TRIGGER fail_queue")
      yield* elapse
      expect(yield* build.status).toMatchObject({ status: "error" })
      yield* release(again)
      const retried = yield* hold(build)
      yield* settled(build, "completed")
      expect(yield* build.status).toEqual({ status: "completed", skipped: 0 })
      expect(yield* titles(db, "walrus")).toEqual(["ses_a", "ses_b", "ses_c"])
      yield* release(retried)
    }),
  )

  it.effect("does not build without the server's run, as in a Durable Object", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const build = yield* SessionSearchBuild.Service
      const held = yield* hold(build)
      yield* elapse
      expect(yield* objects(db)).toBe(0)
      yield* release(held)
    }),
  )

  it.effect("pauses when released and resumes from its cursor", () =>
    Effect.gen(function* () {
      const { db, build } = yield* setup
      yield* SessionSearchIndex.ensure(db)
      expect(yield* SessionSearchIndex.buildChunk(db, { limit: 1 })).toEqual({ done: false })
      expect(yield* build.status).toEqual({
        status: "paused",
        progress: { label: "Indexing session history", numerator: 1, denominator: 3 },
      })
      const resumed = yield* hold(build)
      yield* settled(build, "completed")
      expect(yield* SessionSearchIndex.state(db)).toMatchObject({ status: "done", processed: 3, total: 3 })
      yield* release(resumed)
    }),
  )
})
