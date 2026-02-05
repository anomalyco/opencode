import { describe, expect, test } from "bun:test"
import { Storage } from "../../src/storage/storage"

describe("Storage", () => {
  describe("write and read", () => {
    test("round-trip preserves data", async () => {
      const key = ["test", "roundtrip-" + Math.random().toString(36).slice(2)]
      const data = { name: "alice", age: 30, nested: { ok: true } }
      await Storage.write(key, data)
      const result = await Storage.read<typeof data>(key)
      expect(result).toEqual(data)
      await Storage.remove(key)
    })

    test("overwrites existing key", async () => {
      const key = ["test", "overwrite-" + Math.random().toString(36).slice(2)]
      await Storage.write(key, { v: 1 })
      await Storage.write(key, { v: 2 })
      const result = await Storage.read<{ v: number }>(key)
      expect(result.v).toBe(2)
      await Storage.remove(key)
    })

    test("handles deeply nested keys", async () => {
      const key = ["test", "a", "b", "c", "deep-" + Math.random().toString(36).slice(2)]
      await Storage.write(key, { deep: true })
      const result = await Storage.read<{ deep: boolean }>(key)
      expect(result.deep).toBe(true)
      await Storage.remove(key)
    })

    test("handles various JSON types", async () => {
      const id = Math.random().toString(36).slice(2)
      const cases: [string[], unknown][] = [
        [["test", "type-string-" + id], "hello"],
        [["test", "type-number-" + id], 42],
        [
          ["test", "type-array-" + id],
          [1, 2, 3],
        ],
        [["test", "type-bool-" + id], true],
        [["test", "type-null-" + id], null],
      ]
      for (const [key, value] of cases) {
        await Storage.write(key, value)
        const result = await Storage.read(key)
        expect(result).toEqual(value)
        await Storage.remove(key)
      }
    })
  })

  describe("read errors", () => {
    test("throws NotFoundError for non-existent key", async () => {
      const key = ["test", "does-not-exist-" + Math.random().toString(36).slice(2)]
      await expect(Storage.read(key)).rejects.toThrow(Storage.NotFoundError)
    })
  })

  describe("remove", () => {
    test("deletes an existing key", async () => {
      const key = ["test", "remove-" + Math.random().toString(36).slice(2)]
      await Storage.write(key, { x: 1 })
      await Storage.read(key) // should not throw
      await Storage.remove(key)
      await expect(Storage.read(key)).rejects.toThrow(Storage.NotFoundError)
    })

    test("does not throw when removing a non-existent key", async () => {
      const key = ["test", "remove-missing-" + Math.random().toString(36).slice(2)]
      await expect(Storage.remove(key)).resolves.toBeUndefined()
    })
  })

  describe("update", () => {
    test("mutates existing data in-place", async () => {
      const key = ["test", "update-" + Math.random().toString(36).slice(2)]
      await Storage.write(key, { count: 0, items: ["a"] })
      await Storage.update<{ count: number; items: string[] }>(key, (draft) => {
        draft.count = 5
        draft.items.push("b")
      })
      const result = await Storage.read<{ count: number; items: string[] }>(key)
      expect(result.count).toBe(5)
      expect(result.items).toEqual(["a", "b"])
      await Storage.remove(key)
    })

    test("returns updated content", async () => {
      const key = ["test", "update-return-" + Math.random().toString(36).slice(2)]
      await Storage.write(key, { v: 1 })
      const updated = await Storage.update<{ v: number }>(key, (draft) => {
        draft.v = 99
      })
      expect(updated.v).toBe(99)
      await Storage.remove(key)
    })

    test("throws NotFoundError when key does not exist", async () => {
      const key = ["test", "update-missing-" + Math.random().toString(36).slice(2)]
      await expect(Storage.update(key, () => {})).rejects.toThrow(Storage.NotFoundError)
    })
  })

  describe("list", () => {
    test("returns keys under a prefix", async () => {
      const prefix = "list-" + Math.random().toString(36).slice(2)
      await Storage.write(["test", prefix, "one"], { v: 1 })
      await Storage.write(["test", prefix, "two"], { v: 2 })
      await Storage.write(["test", prefix, "three"], { v: 3 })

      const keys = await Storage.list(["test", prefix])
      expect(keys.length).toBe(3)
      expect(keys).toContainEqual(["test", prefix, "one"])
      expect(keys).toContainEqual(["test", prefix, "two"])
      expect(keys).toContainEqual(["test", prefix, "three"])

      await Storage.remove(["test", prefix, "one"])
      await Storage.remove(["test", prefix, "two"])
      await Storage.remove(["test", prefix, "three"])
    })

    test("returns nested keys with full path segments", async () => {
      const prefix = "list-nested-" + Math.random().toString(36).slice(2)
      await Storage.write(["test", prefix, "a", "b"], { v: 1 })
      await Storage.write(["test", prefix, "a", "c"], { v: 2 })

      const keys = await Storage.list(["test", prefix])
      expect(keys.length).toBe(2)
      expect(keys).toContainEqual(["test", prefix, "a", "b"])
      expect(keys).toContainEqual(["test", prefix, "a", "c"])

      await Storage.remove(["test", prefix, "a", "b"])
      await Storage.remove(["test", prefix, "a", "c"])
    })

    test("returns empty array for non-existent prefix", async () => {
      const keys = await Storage.list(["test", "nonexistent-" + Math.random().toString(36).slice(2)])
      expect(keys).toEqual([])
    })

    test("results are sorted", async () => {
      const prefix = "list-sorted-" + Math.random().toString(36).slice(2)
      await Storage.write(["test", prefix, "c"], 3)
      await Storage.write(["test", prefix, "a"], 1)
      await Storage.write(["test", prefix, "b"], 2)

      const keys = await Storage.list(["test", prefix])
      const names = keys.map((k) => k[k.length - 1])
      expect(names).toEqual([...names].sort())

      await Storage.remove(["test", prefix, "a"])
      await Storage.remove(["test", prefix, "b"])
      await Storage.remove(["test", prefix, "c"])
    })
  })

  describe("concurrent writes", () => {
    test("concurrent writes to the same key do not corrupt data", async () => {
      const key = ["test", "concurrent-" + Math.random().toString(36).slice(2)]
      const writes = Array.from({ length: 10 }, (_, i) => Storage.write(key, { iteration: i }))
      await Promise.all(writes)
      const result = await Storage.read<{ iteration: number }>(key)
      expect(result.iteration).toBeGreaterThanOrEqual(0)
      expect(result.iteration).toBeLessThan(10)
      // Verify it's valid JSON that can be parsed
      expect(typeof result.iteration).toBe("number")
      await Storage.remove(key)
    })

    test("concurrent writes to different keys all succeed", async () => {
      const prefix = "concurrent-multi-" + Math.random().toString(36).slice(2)
      const keys = Array.from({ length: 10 }, (_, i) => ["test", prefix, `key-${i}`])
      await Promise.all(keys.map((key, i) => Storage.write(key, { v: i })))

      for (let i = 0; i < keys.length; i++) {
        const result = await Storage.read<{ v: number }>(keys[i])
        expect(result.v).toBe(i)
      }

      await Promise.all(keys.map((key) => Storage.remove(key)))
    })
  })
})
