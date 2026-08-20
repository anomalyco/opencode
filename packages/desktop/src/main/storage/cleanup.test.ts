import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { Effect, FileSystem, Layer, Path } from "effect"
import { cleanupStoreFiles, deleteStoreFileIfEmpty } from "./cleanup"

const roots: string[] = []
const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer)
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(effect.pipe(Effect.provide(platform)))

const tempRoot = Effect.fn("StorageTest.tempRoot")(function* () {
  const fs = yield* FileSystem.FileSystem
  const root = yield* fs.makeTempDirectory({ directory: tmpdir(), prefix: "opencode-store-cleanup-" })
  roots.push(root)
  return root
})

const writeStore = Effect.fn("StorageTest.writeStore")(function* (
  root: string,
  name: string,
  value: string,
  modified: Date,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.writeFileString(path.join(root, name), value)
  yield* fs.utimes(path.join(root, name), modified, modified)
})

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

describe("store cleanup", () => {
  test("removes empty scoped stores and leaves global stores alone", () =>
    run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const root = yield* tempRoot()
        const now = new Date("2026-07-01T00:00:00.000Z")
        yield* writeStore(root, "opencode.draft.empty.dat", "{}", now)
        yield* writeStore(root, "opencode.workspace.empty.dat", "{\n}", now)
        yield* writeStore(root, "opencode.global.dat", "{}", now)
        yield* writeStore(root, "opencode.workspace.empty.dat.json", "{}", now)

        const result = yield* cleanupStoreFiles(root, now.getTime())

        expect(result.deleted.sort()).toEqual(["opencode.draft.empty.dat", "opencode.workspace.empty.dat"])
        expect((yield* fs.readDirectory(root)).sort()).toEqual([
          "opencode.global.dat",
          "opencode.workspace.empty.dat.json",
        ])
      }),
    ),
  )

  test("removes stale drafts by age without removing non-empty workspace stores", () =>
    run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const root = yield* tempRoot()
        const now = new Date("2026-07-01T00:00:00.000Z")
        yield* writeStore(
          root,
          "opencode.draft.old.dat",
          '{"draft:prompt":"hello"}',
          new Date("2026-05-01T00:00:00.000Z"),
        )
        yield* writeStore(root, "opencode.draft.recent.dat", '{"draft:prompt":"hello"}', now)
        yield* writeStore(
          root,
          "opencode.workspace.old.dat",
          '{"workspace:layout":"wide"}',
          new Date("2025-01-01T00:00:00.000Z"),
        )
        yield* writeStore(root, "opencode.workspace.recent.dat", '{"workspace:layout":"wide"}', now)

        const result = yield* cleanupStoreFiles(root, now.getTime())

        expect(result.deleted).toEqual(["opencode.draft.old.dat"])
        expect((yield* fs.readDirectory(root)).sort()).toEqual([
          "opencode.draft.recent.dat",
          "opencode.workspace.old.dat",
          "opencode.workspace.recent.dat",
        ])
      }),
    ),
  )

  test("caps scoped stores by recency", () =>
    run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const root = yield* tempRoot()
        const now = new Date("2026-07-01T00:00:00.000Z")
        yield* Effect.forEach(
          Array.from({ length: 102 }, (_, index) => index),
          (index) =>
            writeStore(
              root,
              `opencode.draft.${index}.dat`,
              '{"draft:prompt":"hello"}',
              new Date(now.getTime() - index * 1000),
            ),
          { concurrency: "unbounded", discard: true },
        )

        const result = yield* cleanupStoreFiles(root, now.getTime())
        const remaining = yield* fs.readDirectory(root)

        expect(result.deleted.sort()).toEqual(["opencode.draft.100.dat", "opencode.draft.101.dat"])
        expect(remaining).toHaveLength(100)
      }),
    ),
  )

  test("removes a scoped store immediately when it becomes empty", () =>
    run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const root = yield* tempRoot()
        yield* writeStore(root, "opencode.draft.empty.dat", "{}", new Date("2026-07-01T00:00:00.000Z"))
        yield* writeStore(root, "opencode.global.dat", "{}", new Date("2026-07-01T00:00:00.000Z"))

        expect(yield* deleteStoreFileIfEmpty(root, "opencode.draft.empty.dat")).toBe(true)
        expect(yield* deleteStoreFileIfEmpty(root, "opencode.global.dat")).toBe(false)
        expect(yield* fs.readDirectory(root)).toEqual(["opencode.global.dat"])
      }),
    ),
  )
})
