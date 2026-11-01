import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { sqliteLayer } from "@opencode/core/database/sqlite.bun"

const node = Bun.which("node")

// Skipped on Windows for the same Bun.build panic as sqlite-bundle.test.ts.
describe.skipIf(process.platform === "win32" || !node)("node sqlite client", () => {
  test("boots migrations, commits drizzle transactions and types constraint errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqlite-node-"))
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "fixture/sqlite-node-client.ts")],
        target: "node",
        conditions: ["node"],
        outdir: join(dir, "bundle"),
        throw: false,
      })
      expect(build.logs).toEqual([])
      expect(build.success).toBe(true)
      const output = await build.outputs[0].text()
      expect(output).not.toContain("bun:sqlite")

      const child = Bun.spawn([node!, build.outputs[0].path, dir], { stdout: "pipe", stderr: "pipe" })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" })
      expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toEqual({
        journal: "wal",
        reason: "ConstraintError",
        rows: 2,
        inserted: [{ id: 1, name: "Ada" }],
        duplicate: "EffectDrizzleQueryError",
        afterFailure: [{ id: 1, name: "Ada" }],
        raw: 1,
        leakedTransaction: [],
        leakedReserve: [],
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})

describe("bun sqlite client", () => {
  test("types constraint errors and opens read-only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqlite-bun-"))
    const filename = join(dir, "probe.db")
    try {
      const reason = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`CREATE TABLE probe (id TEXT PRIMARY KEY)`
          yield* sql`INSERT INTO probe (id) VALUES ('a')`
          const error = yield* sql`INSERT INTO probe (id) VALUES ('a')`.pipe(Effect.flip)
          return error.reason._tag
        }).pipe(Effect.provide(sqliteLayer({ filename }))),
      )
      expect(reason).toBe("ConstraintError")

      const rows = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ id: string }>`SELECT id FROM probe`
        }).pipe(Effect.provide(sqliteLayer({ filename, readonly: true }))),
      )
      expect(rows).toEqual([{ id: "a" }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
