import { expect, test } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { Cause, Effect } from "effect"
import { sql } from "drizzle-orm"
import path from "path"
import { tmpdir } from "./fixture/tmpdir"

test("preserves native SQLite execution error details", async () => {
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
      expect(cause.message).toContain("Failed to execute statement")
      expect(cause.message).toContain("UNIQUE constraint failed")
    }).pipe(Effect.provide(Database.layerFromPath(path.join(tmp.path, "error.sqlite"))), Effect.scoped),
  )
})
