import { afterEach, describe, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { CodeMigration } from "@/code-migration"
import { CodeMigrationTable } from "@/code-migration.sql"
import { Database } from "@/storage/db"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

afterEach(() => {
  Database.close()
})

describe("CodeMigration", () => {
  it.live("runs each named migration once", () =>
    Effect.gen(function* () {
      const prefix = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const first = `${prefix}-first`
      const sentinel = `${prefix}-sentinel`
      let runs = 0
      const done = yield* Deferred.make<void>()

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          Database.use((db) => {
            db.delete(CodeMigrationTable).where(eq(CodeMigrationTable.name, first)).run()
            db.delete(CodeMigrationTable).where(eq(CodeMigrationTable.name, sentinel)).run()
          })
        }).pipe(Effect.ignore),
      )

      yield* Effect.gen(function* () {
        yield* CodeMigration.Service
        yield* Deferred.await(done)
      }).pipe(
        Effect.provide(
          CodeMigration.make(
            Effect.succeed([
              {
                name: first,
                run: Effect.sync(() => {
                  runs++
                }),
              },
              {
                name: first,
                run: Effect.sync(() => {
                  runs++
                }),
              },
              {
                name: sentinel,
                run: Deferred.succeed(done, undefined).pipe(Effect.asVoid),
              },
            ]),
          ),
        ),
      )

      expect(runs).toBe(1)
      expect(
        Database.use((db) => db.select().from(CodeMigrationTable).where(eq(CodeMigrationTable.name, first)).all()),
      ).toHaveLength(1)
    }),
  )
})
