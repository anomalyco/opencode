import { expect, test } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { Sqlite } from "@opencode-ai/core/database/sqlite"
import { Cause, Effect } from "effect"
import { sql } from "drizzle-orm"
import path from "path"
import { tmpdir } from "./fixture/tmpdir"

test("preserves SQLite execution error codes", async () => {
  await using tmp = await tmpdir()

  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* db.run(sql`CREATE TABLE diagnostic (value text UNIQUE)`)
      yield* db.run(sql`INSERT INTO diagnostic (value) VALUES ('duplicate')`)
      const error = yield* db.run(sql`INSERT INTO diagnostic (value) VALUES ('duplicate')`).pipe(Effect.flip)

      if (!Cause.isCause(error.cause)) throw new Error("Expected query cause")
      const cause = Cause.squash(error.cause)
      if (!(cause instanceof Error)) throw new Error("Expected SQLite cause")
      expect(cause.message).toBe("Failed to execute statement (SQLITE_CONSTRAINT_UNIQUE)")
      expect(cause.message).not.toContain("diagnostic.value")
    }).pipe(Effect.provide(Database.layerFromPath(path.join(tmp.path, "error.sqlite"))), Effect.scoped),
  )
})

test("reports disk exhaustion without copying the native message", () => {
  const bun = Object.assign(new Error("database or disk is full: sensitive-value"), { code: "SQLITE_FULL" })
  const node = Object.assign(new Error("database or disk is full: sensitive-value"), {
    code: "ERR_SQLITE_ERROR",
    errcode: 13,
  })

  expect(Sqlite.executeErrorMessage(bun)).toBe("Failed to execute statement: database or disk is full")
  expect(Sqlite.executeErrorMessage(node)).toBe("Failed to execute statement: database or disk is full")
})
