import { describe, test, expect, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { FileTime } from "../../src/file/time"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

afterEach(() => Instance.disposeAll())

describe("file/time", () => {
  const sessionID = SessionID.make("ses_00000000000000000000000001")

  describe("read() and get()", () => {
    test("stores read timestamp", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const before = await FileTime.get(sessionID, filepath)
          expect(before).toBeUndefined()

          await FileTime.read(sessionID, filepath)
          await Bun.sleep(10)

          const after = await FileTime.get(sessionID, filepath)
          expect(after).toBeInstanceOf(Date)
          expect(after!.getTime()).toBeGreaterThan(0)
        },
      })
    })

    test("tracks separate timestamps per session", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(SessionID.make("ses_00000000000000000000000002"), filepath)
          await FileTime.read(SessionID.make("ses_00000000000000000000000003"), filepath)
          await Bun.sleep(10)

          const time1 = await FileTime.get(SessionID.make("ses_00000000000000000000000002"), filepath)
          const time2 = await FileTime.get(SessionID.make("ses_00000000000000000000000003"), filepath)

          expect(time1).toBeDefined()
          expect(time2).toBeDefined()
        },
      })
    })

    test("updates timestamp on subsequent reads", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(sessionID, filepath)
          await Bun.sleep(10)
          const first = await FileTime.get(sessionID, filepath)

          await Bun.sleep(10)

          FileTime.read(sessionID, filepath)
          await Bun.sleep(10)
          const second = await FileTime.get(sessionID, filepath)

          expect(second!.getTime()).toBeGreaterThanOrEqual(first!.getTime())
        },
      })
    })
  })

  describe("assert()", () => {
    test("passes when file has not been modified", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(sessionID, filepath)
          await Bun.sleep(10)
          await FileTime.assert(sessionID, filepath)
        },
      })
    })

    test("throws when file was not read first", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(FileTime.assert(sessionID, filepath)).rejects.toThrow("You must read file")
        },
      })
    })

    test("throws when file was modified after read", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(sessionID, filepath)
          await Bun.sleep(100)
          await fs.writeFile(filepath, "modified content", "utf-8")
          await expect(FileTime.assert(sessionID, filepath)).rejects.toThrow("modified since it was last read")
        },
      })
    })

    test("includes timestamps in error message", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)
          await Bun.sleep(100)
          await fs.writeFile(filepath, "modified", "utf-8")

          let error: Error | undefined
          try {
            await FileTime.assert(sessionID, filepath)
          } catch (e) {
            error = e as Error
          }
          expect(error).toBeDefined()
          expect(error!.message).toContain("Last modification:")
          expect(error!.message).toContain("Last read:")
        },
      })
    })
  })

  describe("withLock()", () => {
    test("executes function within lock", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let executed = false
          await FileTime.withLock(filepath, async () => {
            executed = true
            return "result"
          })
          expect(executed).toBe(true)
        },
      })
    })

    test("returns function result", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await FileTime.withLock(filepath, async () => {
            return "success"
          })
          expect(result).toBe("success")
        },
      })
    })

    test("serializes concurrent operations on same file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const order: number[] = []

          const op1 = FileTime.withLock(filepath, async () => {
            order.push(1)
            await Bun.sleep(50)
            order.push(2)
          })

          const op2 = FileTime.withLock(filepath, async () => {
            order.push(3)
            order.push(4)
          })

          await Promise.all([op1, op2])
          expect(order).toEqual([1, 2, 3, 4])
        },
      })
    })

    test("allows concurrent operations on different files", async () => {
      await using tmp = await tmpdir()
      const filepath1 = path.join(tmp.path, "file1.txt")
      const filepath2 = path.join(tmp.path, "file2.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let started1 = false
          let started2 = false

          const op1 = FileTime.withLock(filepath1, async () => {
            started1 = true
            await Bun.sleep(50)
            expect(started2).toBe(true)
          })

          const op2 = FileTime.withLock(filepath2, async () => {
            started2 = true
          })

          await Promise.all([op1, op2])
          expect(started1).toBe(true)
          expect(started2).toBe(true)
        },
      })
    })

    test("releases lock even if function throws", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(
            FileTime.withLock(filepath, async () => {
              throw new Error("Test error")
            }),
          ).rejects.toThrow("Test error")

          let executed = false
          await FileTime.withLock(filepath, async () => {
            executed = true
          })
          expect(executed).toBe(true)
        },
      })
    })
  })

  describe("stat() Filesystem.stat pattern", () => {
    test("reads file modification time via Filesystem.stat()", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(sessionID, filepath)
          await Bun.sleep(10)

          const stats = Filesystem.stat(filepath)
          expect(stats?.mtime).toBeInstanceOf(Date)
          expect(stats!.mtime.getTime()).toBeGreaterThan(0)

          await FileTime.assert(sessionID, filepath)
        },
      })
    })

    test("detects modification via stat mtime", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "original", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          FileTime.read(sessionID, filepath)
          await Bun.sleep(10)

          const originalStat = Filesystem.stat(filepath)

          await Bun.sleep(100)
          await fs.writeFile(filepath, "modified", "utf-8")

          const newStat = Filesystem.stat(filepath)
          expect(newStat!.mtime.getTime()).toBeGreaterThan(originalStat!.mtime.getTime())

          await expect(FileTime.assert(sessionID, filepath)).rejects.toThrow()
        },
      })
    })
  })
})
