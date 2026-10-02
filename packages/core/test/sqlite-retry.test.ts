import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import path from "path"
import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { Sqlite } from "../src/database/sqlite"
import { layer } from "../src/database/sqlite.bun"
import { tmpdir } from "./fixture/tmpdir"

describe("SQLite statement failures", () => {
  test("classifies actual node:sqlite errors without losing the original cause", () => {
    const result = Bun.spawnSync([
      "node",
      "-e",
      `
      const { DatabaseSync } = require("node:sqlite")
      const db = new DatabaseSync(":memory:")
      db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES(1)")
      try { db.exec("INSERT INTO t VALUES(1)") }
      catch (error) { console.log(JSON.stringify({ code: error.code, errcode: error.errcode })) }
      db.close()
    `,
    ])
    expect(result.exitCode).toBe(0)
    const cause = JSON.parse(result.stdout.toString())
    expect(cause.code).toBe("ERR_SQLITE_ERROR")
    expect(cause.errcode).toBe(1555)
    const error = Sqlite.statementError(cause)
    expect(error.reason._tag).toBe("ConstraintError")
    expect(error.reason.cause).toBe(cause)
    expect(error.message).toContain("SQLite 1555")
  })

  test.each([{ code: "ERR_SQLITE_ERROR", errcode: 5 }, { code: "SQLITE_BUSY", errno: 5 }, { code: 261 }])(
    "retries transient lock errors: %j",
    async (cause) => {
      let attempts = 0
      const result = await Effect.runPromise(
        Effect.suspend(() => {
          attempts++
          return attempts < 3 ? Effect.fail(Sqlite.statementError(cause)) : Effect.succeed("written")
        }).pipe(Sqlite.retryLocked),
      )
      expect(result).toBe("written")
      expect(attempts).toBe(3)
    },
  )

  test.each([
    { code: "ERR_SQLITE_ERROR", errcode: 517 },
    { code: "SQLITE_BUSY_SNAPSHOT", errno: 517 },
    { code: "SQLITE_BUSY_SNAPSHOT" },
    { code: "ERR_SQLITE_ERROR", errcode: 13 },
    { code: "SQLITE_CORRUPT", errno: 11 },
    { code: "SQLITE_CONSTRAINT", errno: 19 },
  ])("does not retry snapshot, full, corrupt or constraint errors: %j", async (cause) => {
    let attempts = 0
    const error = Sqlite.statementError(cause)
    const result = await Effect.runPromise(
      Effect.suspend(() => {
        attempts++
        return Effect.fail(error)
      }).pipe(Sqlite.retryLocked, Effect.result),
    )
    expect(result._tag).toBe("Failure")
    expect(attempts).toBe(1)
  })

  test("keeps SQL and native message contents out of the visible diagnostic", () => {
    const cause = { code: "ERR_SQLITE_ERROR", errcode: 5, message: "private bound value" }
    const error = Sqlite.statementError(cause)
    expect(error.message).toBe("Failed to execute statement (LockTimeoutError; SQLite 5)")
    expect(error.message).not.toContain(cause.message)
    expect(error.reason.cause).toBe(cause)
  })

  test("preserves unique-constraint classification metadata", () => {
    const cause = Object.assign(new Error("UNIQUE constraint failed: t.id"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 2067,
    })
    const error = Sqlite.statementError(cause)
    expect(error.reason._tag).toBe("UniqueViolation")
    if (error.reason._tag === "UniqueViolation") expect(error.reason.constraint).toBe("t.id")
    expect(error.reason.cause).toBe(cause)
    expect(error.message).not.toContain("t.id")
  })

  test.each([false, true])(
    "Bun driver waits for a competing writer and writes exactly once (values=%s)",
    async (values) => {
      await using tmp = await tmpdir()
      const filename = path.join(tmp.path, "retry.sqlite")
      using blocker = new Database(filename)
      blocker.run("PRAGMA journal_mode = WAL")
      blocker.run("CREATE TABLE t(id INTEGER PRIMARY KEY)")
      await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* SqlClient
          blocker.run("BEGIN IMMEDIATE")
          const release = setTimeout(() => blocker.run("COMMIT"), 150)
          try {
            const query = client.unsafe("INSERT INTO t VALUES(1) RETURNING id")
            expect(yield* values ? query.values : query).toEqual(values ? [[1]] : [{ id: 1 }])
            expect(yield* client.unsafe("SELECT COUNT(*) AS total FROM t")).toEqual([{ total: 1 }])
          } finally {
            clearTimeout(release)
            if (blocker.inTransaction) blocker.run("ROLLBACK")
          }
        }).pipe(Effect.provide(layer({ filename })), Effect.scoped),
      )
    },
  )

  test("statement preparation failures are typed failures rather than defects", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* SqlClient
        const result = yield* Effect.result(client.unsafe("SELECT * FROM missing_table"))
        expect(result._tag).toBe("Failure")
        if (result._tag === "Failure") expect(result.failure.reason.operation).toBe("execute")
      }).pipe(Effect.provide(layer({ filename: ":memory:" })), Effect.scoped),
    )
    expect(result).toBeUndefined()
  })

  test("real Node driver handles competing writers, values, preparation errors and stale snapshots", async () => {
    await using tmp = await tmpdir()
    const build = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "fixture/sqlite-node-worker.ts")],
      target: "node",
    })
    expect(build.success).toBe(true)
    const worker = Bun.spawn(
      ["node", "--input-type=module", "-e", await build.outputs[0].text(), path.join(tmp.path, "node.sqlite")],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const timeout = setTimeout(() => worker.kill(), 10_000)
    try {
      const [code, stdout, stderr] = await Promise.all([
        worker.exited,
        new Response(worker.stdout).text(),
        new Response(worker.stderr).text(),
      ])
      expect(code, stderr).toBe(0)
      expect(stdout.trim()).toBe("Node SQLite checks passed")
    } finally {
      clearTimeout(timeout)
    }
  }, 15_000)

  test("retry sleeps remain interruptible", async () => {
    let attempts = 0
    const result = await Effect.runPromise(
      Effect.suspend(() => {
        attempts++
        return Effect.fail(Sqlite.statementError({ code: "ERR_SQLITE_ERROR", errcode: 5 }))
      }).pipe(Sqlite.retryLocked, Effect.timeout(200), Effect.result),
    )
    expect(result._tag).toBe("Failure")
    const stopped = attempts
    await Bun.sleep(300)
    expect(attempts).toBe(stopped)
  })
})
