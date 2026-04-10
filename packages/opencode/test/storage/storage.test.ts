import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, ManagedRuntime } from "effect"
import { AppFileSystem } from "../../src/filesystem"
import { Git } from "../../src/git"
import { Global } from "../../src/global"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

const dir = path.join(Global.Path.data, "storage")

async function withScope<T>(fn: (root: string[]) => Promise<T>) {
  const root = ["storage_test", crypto.randomUUID()]
  try {
    return await fn(root)
  } finally {
    await fs.rm(path.join(dir, ...root), { recursive: true, force: true })
  }
}

function map(root: string, file: string) {
  if (file === Global.Path.data) return root
  if (file.startsWith(Global.Path.data + path.sep)) return path.join(root, path.relative(Global.Path.data, file))
  return file
}

function layer(root: string) {
  return Layer.effect(
    AppFileSystem.Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      return AppFileSystem.Service.of({
        ...fs,
        isDir: (file) => fs.isDir(map(root, file)),
        readJson: (file) => fs.readJson(map(root, file)),
        writeWithDirs: (file, content, mode) => fs.writeWithDirs(map(root, file), content, mode),
        readFileString: (file) => fs.readFileString(map(root, file)),
        remove: (file) => fs.remove(map(root, file)),
        glob: (pattern, options) =>
          fs.glob(pattern, options?.cwd ? { ...options, cwd: map(root, options.cwd) } : options),
      })
    }),
  ).pipe(Layer.provide(AppFileSystem.defaultLayer))
}

async function withStorage<T>(
  root: string,
  fn: (run: <A, E>(body: Effect.Effect<A, E, Storage.Service>) => Promise<A>) => Promise<T>,
) {
  const rt = ManagedRuntime.make(Storage.layer.pipe(Layer.provide(layer(root)), Layer.provide(Git.defaultLayer)))
  try {
    return await fn((body) => rt.runPromise(body))
  } finally {
    await rt.dispose()
  }
}

async function write(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify(value, null, 2))
}

async function text(file: string, value: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, value)
}

async function exists(file: string) {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
}

describe("Storage", () => {
  test("round-trips JSON content", async () => {
    await withScope(async (root) => {
      const key = [...root, "session_diff", "roundtrip"]
      const value = [{ file: "a.ts", additions: 2, deletions: 1 }]

      await Storage.write(key, value)

      expect(await Storage.read<typeof value>(key)).toEqual(value)
    })
  })

  test("maps missing reads to NotFoundError", async () => {
    await withScope(async (root) => {
      await expect(Storage.read([...root, "missing", "value"])).rejects.toMatchObject({ name: "NotFoundError" })
    })
  })

  test("update on missing key throws NotFoundError", async () => {
    await withScope(async (root) => {
      await expect(
        Storage.update<{ value: number }>([...root, "missing", "key"], (draft) => {
          draft.value += 1
        }),
      ).rejects.toMatchObject({ name: "NotFoundError" })
    })
  })

  test("write overwrites existing value", async () => {
    await withScope(async (root) => {
      const key = [...root, "overwrite", "test"]
      await Storage.write<{ v: number }>(key, { v: 1 })
      await Storage.write<{ v: number }>(key, { v: 2 })

      expect(await Storage.read<{ v: number }>(key)).toEqual({ v: 2 })
    })
  })

  test("remove on missing key is a no-op", async () => {
    await withScope(async (root) => {
      await expect(Storage.remove([...root, "nonexistent", "key"])).resolves.toBeUndefined()
    })
  })

  test("list on missing prefix returns empty", async () => {
    await withScope(async (root) => {
      expect(await Storage.list([...root, "nonexistent"])).toEqual([])
    })
  })

  test("serializes concurrent updates for the same key", async () => {
    await withScope(async (root) => {
      const key = [...root, "counter", "shared"]
      await Storage.write(key, { value: 0 })

      await Promise.all(
        Array.from({ length: 25 }, () =>
          Storage.update<{ value: number }>(key, (draft) => {
            draft.value += 1
          }),
        ),
      )

      expect(await Storage.read<{ value: number }>(key)).toEqual({ value: 25 })
    })
  })

  test("concurrent reads do not block each other", async () => {
    await withScope(async (root) => {
      const key = [...root, "concurrent", "reads"]
      await Storage.write(key, { ok: true })

      const results = await Promise.all(Array.from({ length: 10 }, () => Storage.read(key)))

      expect(results).toHaveLength(10)
      for (const r of results) expect(r).toEqual({ ok: true })
    })
  })

  test("nested keys create deep paths", async () => {
    await withScope(async (root) => {
      const key = [...root, "a", "b", "c", "deep"]
      await Storage.write<{ nested: boolean }>(key, { nested: true })

      expect(await Storage.read<{ nested: boolean }>(key)).toEqual({ nested: true })
      expect(await Storage.list([...root, "a"])).toEqual([key])
    })
  })

  test("lists and removes stored entries", async () => {
    await withScope(async (root) => {
      const a = [...root, "list", "a"]
      const b = [...root, "list", "b"]
      const prefix = [...root, "list"]

      await Storage.write(b, { value: 2 })
      await Storage.write(a, { value: 1 })

      expect(await Storage.list(prefix)).toEqual([a, b])

      await Storage.remove(a)

      expect(await Storage.list(prefix)).toEqual([b])
      await expect(Storage.read(a)).rejects.toMatchObject({ name: "NotFoundError" })
    })
  })

  test("migration 2 runs when marker contents are invalid", async () => {
    await using tmp = await tmpdir()
    const storage = path.join(tmp.path, "storage")
    const diffs = [
      { additions: 2, deletions: 1 },
      { additions: 3, deletions: 4 },
    ]

    await text(path.join(storage, "migration"), "wat")
    await write(path.join(storage, "session", "proj_test", "ses_test.json"), {
      id: "ses_test",
      projectID: "proj_test",
      title: "legacy",
      summary: { diffs },
    })

    await withStorage(tmp.path, async (run) => {
      expect(await run(Storage.Service.use((svc) => svc.list(["session_diff"])))).toEqual([
        ["session_diff", "ses_test"],
      ])
      expect(await run(Storage.Service.use((svc) => svc.read<typeof diffs>(["session_diff", "ses_test"])))).toEqual(
        diffs,
      )
      expect(
        await run(
          Storage.Service.use((svc) =>
            svc.read<{
              id: string
              projectID: string
              title: string
              summary: {
                additions: number
                deletions: number
              }
            }>(["session", "proj_test", "ses_test"]),
          ),
        ),
      ).toEqual({
        id: "ses_test",
        projectID: "proj_test",
        title: "legacy",
        summary: {
          additions: 5,
          deletions: 5,
        },
      })
    })

    expect(await Bun.file(path.join(storage, "migration")).text()).toBe("2")
  })

  test("migration 1 tolerates malformed legacy records", async () => {
    await using tmp = await tmpdir({ git: true })
    const storage = path.join(tmp.path, "storage")
    const legacy = path.join(tmp.path, "project", "legacy")

    await write(path.join(legacy, "storage", "session", "message", "probe", "0.json"), [])
    await write(path.join(legacy, "storage", "session", "message", "probe", "1.json"), {
      path: { root: tmp.path },
    })
    await write(path.join(legacy, "storage", "session", "info", "ses_legacy.json"), {
      id: "ses_legacy",
      title: "legacy",
    })
    await write(path.join(legacy, "storage", "session", "message", "ses_legacy", "msg_legacy.json"), {
      role: "user",
      text: "hello",
    })

    await withStorage(tmp.path, async (run) => {
      const projects = await run(Storage.Service.use((svc) => svc.list(["project"])))
      expect(projects).toHaveLength(1)
      const project = projects[0]![1]

      expect(await run(Storage.Service.use((svc) => svc.list(["session", project])))).toEqual([
        ["session", project, "ses_legacy"],
      ])
      expect(
        await run(
          Storage.Service.use((svc) => svc.read<{ id: string; title: string }>(["session", project, "ses_legacy"])),
        ),
      ).toEqual({
        id: "ses_legacy",
        title: "legacy",
      })
      expect(
        await run(
          Storage.Service.use((svc) =>
            svc.read<{ role: string; text: string }>(["message", "ses_legacy", "msg_legacy"]),
          ),
        ),
      ).toEqual({
        role: "user",
        text: "hello",
      })
    })

    expect(await Bun.file(path.join(storage, "migration")).text()).toBe("2")
  })

  test("failed migrations do not advance the marker", async () => {
    await using tmp = await tmpdir()
    const storage = path.join(tmp.path, "storage")
    const legacy = path.join(tmp.path, "project", "legacy")

    await text(path.join(legacy, "storage", "session", "message", "probe", "0.json"), "{")

    await withStorage(tmp.path, async (run) => {
      expect(await run(Storage.Service.use((svc) => svc.list(["project"])))).toEqual([])
    })

    expect(await exists(path.join(storage, "migration"))).toBe(false)
  })
})
