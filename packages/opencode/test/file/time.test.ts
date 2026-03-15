import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { FileTime } from "../../src/file/time"

afterEach(() => Instance.disposeAll())

test("read records a timestamp for a file", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "test.txt")
  await fs.writeFile(file, "hello")

  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      const before = new Date()
      FileTime.read("session-1", file)
      const time = FileTime.get("session-1", file)
      expect(time).toBeDefined()
      expect(time!.getTime()).toBeGreaterThanOrEqual(before.getTime())
    },
  })
})

test("get returns undefined for unread files", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      expect(FileTime.get("session-1", "/nonexistent")).toBeUndefined()
    },
  })
})

test("read times are scoped per session", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "test.txt")
  await fs.writeFile(file, "hello")

  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      FileTime.read("session-a", file)
      expect(FileTime.get("session-a", file)).toBeDefined()
      expect(FileTime.get("session-b", file)).toBeUndefined()
    },
  })
})

test("assert throws if file was not read first", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "test.txt")
  await fs.writeFile(file, "hello")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(FileTime.assert("session-1", file)).rejects.toThrow("must read file")
    },
  })
})

test("assert passes if file unchanged since read", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "test.txt")
  await fs.writeFile(file, "hello")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      FileTime.read("session-1", file)
      await FileTime.assert("session-1", file)
    },
  })
})

test("assert throws if file modified after read", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "test.txt")
  await fs.writeFile(file, "hello")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      FileTime.read("session-1", file)
      await Bun.sleep(100)
      await fs.writeFile(file, "modified")
      expect(FileTime.assert("session-1", file)).rejects.toThrow("has been modified")
    },
  })
})

test("withLock serializes concurrent writes to same file", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "locked.txt")
  await fs.writeFile(file, "")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const order: number[] = []

      const a = FileTime.withLock(file, async () => {
        order.push(1)
        await Bun.sleep(50)
        order.push(2)
      })

      const b = FileTime.withLock(file, async () => {
        order.push(3)
        await Bun.sleep(10)
        order.push(4)
      })

      await Promise.all([a, b])
      expect(order).toEqual([1, 2, 3, 4])
    },
  })
})
