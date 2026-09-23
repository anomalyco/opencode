import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { sql } from "drizzle-orm"
import { Effect, FileSystem, Layer, Path } from "effect"
import { openDatabase } from "./database"
import { importLegacyStores } from "./legacy"

const roots: string[] = []
const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer)
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(effect.pipe(Effect.provide(platform)))
const now = new Date("2026-07-01T00:00:00.000Z")
const day = 24 * 60 * 60 * 1000

const tempRoot = Effect.fn("LegacyTest.tempRoot")(function* () {
  const fs = yield* FileSystem.FileSystem
  const root = yield* fs.makeTempDirectory({ directory: tmpdir(), prefix: "opencode-legacy-store-" })
  roots.push(root)
  return root
})

const writeStore = Effect.fn("LegacyTest.writeStore")(function* (
  root: string,
  name: string,
  value: string,
  modified = now,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.writeFileString(path.join(root, name), value)
  yield* fs.utimes(path.join(root, name), modified, modified)
})

const listing = Effect.fn("LegacyTest.listing")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem
  return (yield* fs.readDirectory(root)).sort()
})

const rows = (db: ReturnType<typeof openDatabase>["db"]) =>
  db.all<{ name: string; key: string; value: string }>(sql`SELECT name, key, value FROM state ORDER BY name, key`)

afterEach(() =>
  run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      yield* Effect.forEach(roots.splice(0), (root) => fs.remove(root, { recursive: true, force: true }), {
        concurrency: "unbounded",
        discard: true,
      })
    }),
  ),
)

describe("legacy store import", () => {
  test("copies every namespace into state and removes the files", () =>
    run(
      Effect.gen(function* () {
        const root = yield* tempRoot()
        const database = openDatabase(":memory:")
        yield* writeStore(root, "opencode.global.dat", JSON.stringify({ model: "m", layout: { sidebar: 1 } }))
        yield* writeStore(root, "opencode.window.w1.dat", JSON.stringify({ tabs: "[]" }))
        yield* writeStore(root, "default.dat", JSON.stringify({ "settings.v3": "{}" }))
        yield* writeStore(root, "opencode.settings", JSON.stringify({ keep: true }))
        yield* writeStore(root, "unrelated.txt", "x")

        const result = yield* importLegacyStores(database.db, root, now.getTime())

        expect(result.imported).toBe(4)
        expect(rows(database.db)).toEqual([
          { name: "default.dat", key: "settings.v3", value: "{}" },
          { name: "opencode.global.dat", key: "layout", value: '{"sidebar":1}' },
          { name: "opencode.global.dat", key: "model", value: "m" },
          { name: "opencode.window.w1.dat", key: "tabs", value: "[]" },
        ])
        expect(yield* listing(root)).toEqual(["opencode.settings", "unrelated.txt"])
      }),
    ))

  test("does not overwrite state that already exists", () =>
    run(
      Effect.gen(function* () {
        const root = yield* tempRoot()
        const database = openDatabase(":memory:")
        database.db.run(sql`INSERT INTO state VALUES ('opencode.global.dat', 'model', 'new', 0)`)
        yield* writeStore(root, "opencode.global.dat", JSON.stringify({ model: "old" }))

        yield* importLegacyStores(database.db, root, now.getTime())

        expect(rows(database.db)).toEqual([{ name: "opencode.global.dat", key: "model", value: "new" }])
        expect(yield* listing(root)).toEqual([])
      }),
    ))

  test("leaves unreadable files in place", () =>
    run(
      Effect.gen(function* () {
        const root = yield* tempRoot()
        const database = openDatabase(":memory:")
        yield* writeStore(root, "opencode.global.dat", "{not json")
        yield* writeStore(root, "opencode.workspace.x.dat", JSON.stringify({ terminal: "{}" }))

        const result = yield* importLegacyStores(database.db, root, now.getTime())

        expect(result.imported).toBe(1)
        expect(yield* listing(root)).toEqual(["opencode.global.dat"])
      }),
    ))

  test("applies draft retention: skips empty, stale, and excess draft files", () =>
    run(
      Effect.gen(function* () {
        const root = yield* tempRoot()
        const database = openDatabase(":memory:")
        yield* writeStore(root, "opencode.draft.empty.dat", "{}")
        yield* writeStore(
          root,
          "opencode.draft.stale.dat",
          JSON.stringify({ "draft:prompt": "old" }),
          new Date(now.getTime() - 31 * day),
        )
        yield* Effect.forEach(
          Array.from({ length: 102 }, (_, index) => index),
          (index) =>
            writeStore(
              root,
              `opencode.draft.${index}.dat`,
              JSON.stringify({ "draft:prompt": `${index}` }),
              new Date(now.getTime() - index * 1_000),
            ),
          { concurrency: 5 },
        )

        const result = yield* importLegacyStores(database.db, root, now.getTime())

        expect(result.imported).toBe(100)
        const names = rows(database.db).map((row) => row.name)
        expect(names).toContain("opencode.draft.0.dat")
        expect(names).toContain("opencode.draft.99.dat")
        expect(names).not.toContain("opencode.draft.100.dat")
        expect(names).not.toContain("opencode.draft.101.dat")
        expect(names).not.toContain("opencode.draft.stale.dat")
        expect(names).not.toContain("opencode.draft.empty.dat")
        expect(yield* listing(root)).toEqual([])
      }),
    ))
})
