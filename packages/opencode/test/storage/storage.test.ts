import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { Storage } from "../../src/storage/storage"

const dir = path.join(Global.Path.data, "storage")

async function withScope<T>(fn: (root: string[]) => Promise<T>) {
  const root = ["storage_test", crypto.randomUUID()]
  try {
    return await fn(root)
  } finally {
    await fs.rm(path.join(dir, ...root), { recursive: true, force: true })
  }
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
})
