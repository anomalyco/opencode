import { expect } from "bun:test"
import { existsSync } from "node:fs"
import { statfs } from "node:fs/promises"
import path from "path"
import { Effect } from "effect"
import { Database } from "@opencode/core/database/database"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const open = <A, E>(filename: string, wal: boolean | undefined, effect: Effect.Effect<A, E, Database.Service>) =>
  effect.pipe(
    Effect.provide(Database.layer({ path: filename, wal })),
    Effect.provideService(Global.Service, Global.make({ data: path.dirname(filename) })),
    Effect.scoped,
  )

const journal = Effect.gen(function* () {
  const { db } = yield* Database.Service
  return (yield* db.get<{ journal_mode: string }>("PRAGMA journal_mode"))!.journal_mode
})

it.live("selects the default journal from the database filesystem", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const filename = path.join(tmp.path, "default.db")
    const mode = yield* open(filename, undefined, journal)
    const stats = yield* Effect.promise(() => statfs(filename))
    expect(mode).toBe(process.platform === "linux" && stats.type === 0x6969 ? "delete" : "wal")
  }),
)

it.live("explicit WAL overrides automatic selection", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    expect(yield* open(path.join(tmp.path, "wal.db"), true, journal)).toBe("wal")
  }),
)

it.live("rollback mode creates no WAL sidecars while the database is open", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const filename = path.join(tmp.path, "rollback.db")
    yield* open(
      filename,
      false,
      Effect.gen(function* () {
        expect(yield* journal).toBe("delete")
        expect(existsSync(filename + "-wal")).toBe(false)
        expect(existsSync(filename + "-shm")).toBe(false)
      }),
    )
  }),
)

it.live("preserves data when converting a closed WAL database and reopening rollback", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const filename = path.join(tmp.path, "existing.db")
    yield* open(
      filename,
      true,
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db.run("CREATE TABLE journal_probe (value TEXT NOT NULL)")
        yield* db.run("INSERT INTO journal_probe VALUES ('preserved')")
        expect(yield* journal).toBe("wal")
      }),
    )
    for (let i = 0; i < 2; i++) {
      yield* open(
        filename,
        false,
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          expect(yield* journal).toBe("delete")
          expect(yield* db.all("SELECT value FROM journal_probe")).toEqual([{ value: "preserved" }])
          expect(yield* db.all("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }])
        }),
      )
    }
  }),
)

it.live("keeps in-memory databases in memory journal mode", () =>
  Effect.gen(function* () {
    expect(yield* open(":memory:", undefined, journal)).toBe("memory")
  }),
)
