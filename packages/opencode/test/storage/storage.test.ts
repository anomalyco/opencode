import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Exit, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Git } from "../../src/git"
import { Global } from "../../src/global"
import { Storage } from "../../src/storage"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const dir = path.join(Global.Path.data, "storage")

const it = testEffect(Layer.mergeAll(Storage.defaultLayer, AppFileSystem.defaultLayer, CrossSpawnSpawner.defaultLayer))

const scope = Effect.fnUntraced(function* () {
  const root = ["storage_test", crypto.randomUUID()]
  const fs = yield* AppFileSystem.Service
  const svc = yield* Storage.Service
  yield* Effect.addFinalizer(() =>
    fs.remove(path.join(dir, ...root), { recursive: true, force: true }).pipe(Effect.ignore),
  )
  return { root, svc }
})

// remap(root) rewrites any path under Global.Path.data to live under `root` instead.
// Used by remappedFs to build an AppFileSystem that Storage thinks is the real global
// data dir but actually targets a tmp dir — letting migration tests stage legacy layouts.
// NOTE: only the 6 methods below are intercepted. If Storage starts using a different
// AppFileSystem method that touches Global.Path.data, add it here.
function remap(root: string, file: string) {
  if (file === Global.Path.data) return root
  if (file.startsWith(Global.Path.data + path.sep)) return path.join(root, path.relative(Global.Path.data, file))
  return file
}

function remappedFs(root: string) {
  return Layer.effect(
    AppFileSystem.Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      return AppFileSystem.Service.of({
        ...fs,
        isDir: (file) => fs.isDir(remap(root, file)),
        readJson: (file) => fs.readJson(remap(root, file)),
        writeWithDirs: (file, content, mode) => fs.writeWithDirs(remap(root, file), content, mode),
        readFileString: (file) => fs.readFileString(remap(root, file)),
        remove: (file) => fs.remove(remap(root, file)),
        glob: (pattern, options) =>
          fs.glob(pattern, options?.cwd ? { ...options, cwd: remap(root, options.cwd) } : options),
      })
    }),
  ).pipe(Layer.provide(AppFileSystem.defaultLayer))
}

// Layer.fresh forces a new Storage instance — without it, Effect's in-test layer cache
// returns the outer testEffect's Storage (which uses the real AppFileSystem), not a new
// one built on top of remappedFs.
const remappedStorage = (root: string) =>
  Layer.fresh(Storage.layer.pipe(Layer.provide(remappedFs(root)), Layer.provide(Git.defaultLayer)))

describe("Storage", () => {
  it.live("round-trips JSON content", () =>
    Effect.gen(function* () {
      const { root, svc } = yield* scope()
      const key = [...root, "session_diff", "roundtrip"]
      const value = [{ file: "a.ts", additions: 2, deletions: 1 }]

      yield* svc.write(key, value)
      expect(yield* svc.read<typeof value>(key)).toEqual(value)
    }),
  )

  it.live("maps missing reads to NotFoundError", () =>
    Effect.gen(function* () {
      const { root, svc } = yield* scope()
      const exit = yield* svc.read([...root, "missing", "value"]).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.live("update on missing key throws NotFoundError", () =>
    Effect.gen(function* () {
      const { root, svc } = yield* scope()
      const exit = yield* svc
        .update<{ value: number }>([...root, "missing", "key"], (draft) => {
          draft.value += 1
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.live("write overwrites existing value", () =>
    Effect.gen(function* () {
      const { root, svc } = yield* scope()
      const key = [...root, "overwrite", "test"]

      yield* svc.write<{ v: number }>(key, { v: 1 })
      yield* svc.write<{ v: number }>(key, { v: 2 })

      expect(yield* svc.read<{ v: number }>(key)).toEqual({ v: 2 })
    }),
  )

  it.live("remove on missing key is a no-op", () =>
    Effect.gen(function* () {
      const { root, svc } = yield* scope()
      yield* svc.remove([...root, "nonexistent", "key"])
    }),
  )

  it.live("list on missing prefix returns empty", () =>
    Effect.gen(function* () {
      const { root, svc } = yield* scope()
      expect(yield* svc.list([...root, "nonexistent"])).toEqual([])
    }),
  )

  it.live("serializes concurrent updates for the same key", () =>
    Effect.gen(function* () {
      const { root, svc } = yield* scope()
      const key = [...root, "counter", "shared"]

      yield* svc.write(key, { value: 0 })

      yield* Effect.all(
        Array.from({ length: 25 }, () =>
          svc.update<{ value: number }>(key, (draft) => {
            draft.value += 1
          }),
        ),
        { concurrency: "unbounded" },
      )

      expect(yield* svc.read<{ value: number }>(key)).toEqual({ value: 25 })
    }),
  )

  it.live("concurrent reads do not block each other", () =>
    Effect.gen(function* () {
      const { root, svc } = yield* scope()
      const key = [...root, "concurrent", "reads"]

      yield* svc.write(key, { ok: true })

      const results = yield* Effect.all(
        Array.from({ length: 10 }, () => svc.read(key)),
        { concurrency: "unbounded" },
      )

      expect(results).toHaveLength(10)
      for (const r of results) expect(r).toEqual({ ok: true })
    }),
  )

  it.live("nested keys create deep paths", () =>
    Effect.gen(function* () {
      const { root, svc } = yield* scope()
      const key = [...root, "a", "b", "c", "deep"]

      yield* svc.write<{ nested: boolean }>(key, { nested: true })

      expect(yield* svc.read<{ nested: boolean }>(key)).toEqual({ nested: true })
      expect(yield* svc.list([...root, "a"])).toEqual([key])
    }),
  )

  it.live("lists and removes stored entries", () =>
    Effect.gen(function* () {
      const { root, svc } = yield* scope()
      const a = [...root, "list", "a"]
      const b = [...root, "list", "b"]
      const prefix = [...root, "list"]

      yield* svc.write(b, { value: 2 })
      yield* svc.write(a, { value: 1 })

      expect(yield* svc.list(prefix)).toEqual([a, b])

      yield* svc.remove(a)

      expect(yield* svc.list(prefix)).toEqual([b])
      const exit = yield* svc.read(a).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.live("migration 2 runs when marker contents are invalid", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const tmp = yield* tmpdirScoped()
      const storage = path.join(tmp, "storage")
      const diffs = [
        { additions: 2, deletions: 1 },
        { additions: 3, deletions: 4 },
      ]

      yield* fs.writeWithDirs(path.join(storage, "migration"), "wat")
      yield* fs.writeWithDirs(
        path.join(storage, "session", "proj_test", "ses_test.json"),
        JSON.stringify({
          id: "ses_test",
          projectID: "proj_test",
          title: "legacy",
          summary: { diffs },
        }),
      )

      yield* Effect.gen(function* () {
        const svc = yield* Storage.Service
        expect(yield* svc.list(["session_diff"])).toEqual([["session_diff", "ses_test"]])
        expect(yield* svc.read<typeof diffs>(["session_diff", "ses_test"])).toEqual(diffs)
        expect(
          yield* svc.read<{
            id: string
            projectID: string
            title: string
            summary: { additions: number; deletions: number }
          }>(["session", "proj_test", "ses_test"]),
        ).toEqual({
          id: "ses_test",
          projectID: "proj_test",
          title: "legacy",
          summary: { additions: 5, deletions: 5 },
        })
      }).pipe(Effect.provide(remappedStorage(tmp)))

      expect(yield* fs.readFileString(path.join(storage, "migration"))).toBe("2")
    }),
  )

  it.live("migration 1 tolerates malformed legacy records", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const tmp = yield* tmpdirScoped({ git: true })
      const storage = path.join(tmp, "storage")
      const legacy = path.join(tmp, "project", "legacy")

      yield* fs.writeWithDirs(path.join(legacy, "storage", "session", "message", "probe", "0.json"), "[]")
      yield* fs.writeWithDirs(
        path.join(legacy, "storage", "session", "message", "probe", "1.json"),
        JSON.stringify({ path: { root: tmp } }),
      )
      yield* fs.writeWithDirs(
        path.join(legacy, "storage", "session", "info", "ses_legacy.json"),
        JSON.stringify({ id: "ses_legacy", title: "legacy" }),
      )
      yield* fs.writeWithDirs(
        path.join(legacy, "storage", "session", "message", "ses_legacy", "msg_legacy.json"),
        JSON.stringify({ role: "user", text: "hello" }),
      )

      yield* Effect.gen(function* () {
        const svc = yield* Storage.Service
        const projects = yield* svc.list(["project"])
        expect(projects).toHaveLength(1)
        const project = projects[0]![1]

        expect(yield* svc.list(["session", project])).toEqual([["session", project, "ses_legacy"]])
        expect(yield* svc.read<{ id: string; title: string }>(["session", project, "ses_legacy"])).toEqual({
          id: "ses_legacy",
          title: "legacy",
        })
        expect(yield* svc.read<{ role: string; text: string }>(["message", "ses_legacy", "msg_legacy"])).toEqual({
          role: "user",
          text: "hello",
        })
      }).pipe(Effect.provide(remappedStorage(tmp)))

      expect(yield* fs.readFileString(path.join(storage, "migration"))).toBe("2")
    }),
  )

  it.live("failed migrations do not advance the marker", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const tmp = yield* tmpdirScoped()
      const storage = path.join(tmp, "storage")
      const legacy = path.join(tmp, "project", "legacy")

      yield* fs.writeWithDirs(path.join(legacy, "storage", "session", "message", "probe", "0.json"), "{")

      yield* Effect.gen(function* () {
        const svc = yield* Storage.Service
        expect(yield* svc.list(["project"])).toEqual([])
      }).pipe(Effect.provide(remappedStorage(tmp)))

      const exit = yield* fs.access(path.join(storage, "migration")).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
