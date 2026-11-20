import path from "path"
import { describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
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
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionSearchBuild.node])))
const standalone = testEffect(Layer.empty)

const directory = AbsolutePath.make("/project")

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
const settled = (db: Database.Interface["db"], status: SessionSearchIndex.State["status"]) =>
  until(
    SessionSearchIndex.state(db).pipe(
      Effect.map((state) => state !== undefined && "status" in state && state.status === status),
    ),
  )

/** Sessions whose title matches `word`. */
const titles = (db: Database.Interface["db"], word: string) =>
  db
    .all<{ source: string }>(
      sql`
      SELECT document.source_id AS source
      FROM session_search JOIN session_search_document AS document ON document.id = session_search.rowid
      WHERE session_search MATCH ${word}
    `,
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.source).toSorted()))

const objects = (db: Database.Interface["db"]) =>
  db.all(sql`SELECT name FROM sqlite_master WHERE name GLOB 'session_search*'`).pipe(Effect.map((rows) => rows.length))

const failOn = (db: Database.Interface["db"], ids: string) =>
  db.run(
    `CREATE TRIGGER fail_document BEFORE INSERT ON session_search_document WHEN NEW.source_id IN (${ids}) BEGIN SELECT RAISE(ABORT, 'induced'); END`,
  )

describe("SessionSearchBuild", () => {
  it.effect("does nothing until started", () =>
    Effect.gen(function* () {
      const { db } = yield* setup
      yield* elapse
      expect(yield* objects(db)).toBe(0)
      expect(yield* SessionSearchIndex.state(db)).toBeUndefined()
    }),
  )

  it.effect("builds once started and records it done; triggers keep it current", () =>
    Effect.gen(function* () {
      const { db, insert, build } = yield* setup
      yield* build.start
      yield* build.start
      yield* settled(db, "done")
      expect(yield* titles(db, "walrus")).toEqual(["ses_a", "ses_b", "ses_c"])
      expect(yield* SessionSearchIndex.state(db)).toMatchObject({ status: "done", skipped: 0 })
      yield* insert("ses_d", "Fresh narwhal plans")
      expect(yield* titles(db, "narwhal")).toEqual(["ses_d"])
    }),
  )

  it.effect("skips a row that fails alone", () =>
    Effect.gen(function* () {
      const { db, build } = yield* setup
      yield* SessionSearchIndex.ensure(db)
      yield* failOn(db, "'ses_b'")
      yield* build.start
      yield* settled(db, "done")
      expect(yield* titles(db, "walrus")).toEqual(["ses_a", "ses_c"])
      expect(yield* SessionSearchIndex.state(db)).toMatchObject({ status: "done", skipped: 1 })
    }),
  )

  it.effect("fails when every row does, and records why", () =>
    Effect.gen(function* () {
      const { db, build } = yield* setup
      yield* SessionSearchIndex.ensure(db)
      yield* failOn(db, "'ses_a', 'ses_b', 'ses_c'")
      yield* build.start
      yield* settled(db, "failed")
      expect(yield* SessionSearchIndex.state(db)).toMatchObject({
        status: "failed",
        error: expect.stringContaining("induced"),
      })
    }),
  )

  it.effect("retries a build that failed before this process started", () =>
    Effect.gen(function* () {
      const { db, build } = yield* setup
      yield* SessionSearchIndex.ensure(db)
      yield* SessionSearchIndex.buildChunk(db, { limit: 1 })
      yield* SessionSearchIndex.fail(db, "disk full")
      yield* build.start
      yield* settled(db, "done")
      expect(yield* titles(db, "walrus")).toEqual(["ses_a", "ses_b", "ses_c"])
    }),
  )

  it.effect("resumes from its cursor", () =>
    Effect.gen(function* () {
      const { db, build } = yield* setup
      yield* SessionSearchIndex.ensure(db)
      expect(yield* SessionSearchIndex.buildChunk(db, { limit: 1 })).toEqual({ done: false })
      expect(yield* SessionSearchIndex.state(db)).toMatchObject({ status: "building", processed: 1, total: 3 })
      yield* build.start
      yield* settled(db, "done")
      expect(yield* SessionSearchIndex.state(db)).toMatchObject({ status: "done", processed: 3, total: 3 })
    }),
  )

  it.effect("does not build without the server's run, as in a Durable Object", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const build = yield* SessionSearchBuild.Service
      yield* build.start
      yield* elapse
      expect(yield* objects(db)).toBe(0)
    }),
  )

  standalone.effect("waits out SQLITE_BUSY during ensure and finishes once the lock clears", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const file = path.join(tmp.path, "busy.db")
      const sqlite = yield* Effect.promise(() => import("bun:sqlite"))
      const dbLayer = Database.layer({ path: file }).pipe(
        Layer.provide(Layer.succeed(Global.Service, Global.make({ data: tmp.path }))),
      )
      const ctx = yield* Layer.build(Layer.provideMerge(SessionSearchBuild.layer, dbLayer))
      const db = Context.get(ctx, Database.Service).db
      const build = Context.get(ctx, SessionSearchBuild.Service)
      yield* db.run("PRAGMA busy_timeout = 1")
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: directory, sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: Session.ID.make("ses_a"),
          project_id: Project.ID.global,
          slug: "ses_a",
          directory,
          title: "Locked walrus",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)

      const locker = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const conn = new sqlite.Database(file)
          conn.run("BEGIN IMMEDIATE")
          return conn
        }),
        (conn) => Effect.sync(() => conn.close()),
      )

      yield* build.run.pipe(Effect.forkScoped)
      yield* build.start
      // bun:sqlite runs BEGIN IMMEDIATE synchronously, so a brief pause hits SQLITE_BUSY and parks on TestClock.
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)))
      locker.run("ROLLBACK")
      yield* settled(db, "done")
      expect(yield* titles(db, "walrus")).toEqual(["ses_a"])
    }),
  )
})
