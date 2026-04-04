import { describe, test, expect, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { FileTime } from "../../src/file/time"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

async function touch(file: string, time: number) {
  const date = new Date(time)
  await fs.utimes(file, date, date)
}

function gate() {
  let open!: () => void
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, wait }
}

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
          await FileTime.read(sessionID, filepath)
          const first = await FileTime.get(sessionID, filepath)

          await FileTime.read(sessionID, filepath)
          const second = await FileTime.get(sessionID, filepath)

          expect(second!.getTime()).toBeGreaterThanOrEqual(first!.getTime())
        },
      })
    })

    test("isolates reads by directory", async () => {
      await using one = await tmpdir()
      await using two = await tmpdir()
      await using shared = await tmpdir()
      const filepath = path.join(shared.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: one.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)
        },
      })

      await Instance.provide({
        directory: two.path,
        fn: async () => {
          expect(await FileTime.get(sessionID, filepath)).toBeUndefined()
        },
      })
    })
  })

  describe("assert()", () => {
    test("passes when file has not been modified", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")
      await touch(filepath, 1_000)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)
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
      await touch(filepath, 1_000)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)
          await fs.writeFile(filepath, "modified content", "utf-8")
          await touch(filepath, 2_000)
          await expect(FileTime.assert(sessionID, filepath)).rejects.toThrow("modified since it was last read")
        },
      })
    })

    test("includes timestamps in error message", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")
      await touch(filepath, 1_000)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)
          await fs.writeFile(filepath, "modified", "utf-8")
          await touch(filepath, 2_000)

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
          const hold = gate()
          const ready = gate()

          const op1 = FileTime.withLock(filepath, async () => {
            order.push(1)
            ready.open()
            await hold.wait
            order.push(2)
          })

          await ready.wait

          const op2 = FileTime.withLock(filepath, async () => {
            order.push(3)
            order.push(4)
          })

          hold.open()

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
          const hold = gate()
          const ready = gate()

          const op1 = FileTime.withLock(filepath1, async () => {
            started1 = true
            ready.open()
            await hold.wait
            expect(started2).toBe(true)
          })

          await ready.wait

          const op2 = FileTime.withLock(filepath2, async () => {
            started2 = true
            hold.open()
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

  describe("path normalization", () => {
    test("read with forward slashes, assert with backslashes", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")
      await touch(filepath, 1_000)

      const forwardSlash = filepath.replaceAll("\\", "/")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, forwardSlash)
          // assert with the native backslash path should still work
          await FileTime.assert(sessionID, filepath)
        },
      })
    })

    test("read with backslashes, assert with forward slashes", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")
      await touch(filepath, 1_000)

      const forwardSlash = filepath.replaceAll("\\", "/")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)
          // assert with forward slashes should still work
          await FileTime.assert(sessionID, forwardSlash)
        },
      })
    })

    test("get returns timestamp regardless of slash direction", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      const forwardSlash = filepath.replaceAll("\\", "/")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, forwardSlash)
          const result = await FileTime.get(sessionID, filepath)
          expect(result).toBeInstanceOf(Date)
        },
      })
    })

    test("withLock serializes regardless of slash direction", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")

      const forwardSlash = filepath.replaceAll("\\", "/")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const order: number[] = []
          const hold = gate()
          const ready = gate()

          const op1 = FileTime.withLock(filepath, async () => {
            order.push(1)
            ready.open()
            await hold.wait
            order.push(2)
          })

          await ready.wait

          // Use forward-slash variant -- should still serialize against op1
          const op2 = FileTime.withLock(forwardSlash, async () => {
            order.push(3)
            order.push(4)
          })

          hold.open()

          await Promise.all([op1, op2])
          expect(order).toEqual([1, 2, 3, 4])
        },
      })
    })
  })

  describe("stat() Filesystem.stat pattern", () => {
    test("reads file modification time via Filesystem.stat()", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")
      await touch(filepath, 1_000)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)

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
      await touch(filepath, 1_000)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)

          const originalStat = Filesystem.stat(filepath)

          await fs.writeFile(filepath, "modified", "utf-8")
          await touch(filepath, 2_000)

          const newStat = Filesystem.stat(filepath)
          expect(newStat!.mtime.getTime()).toBeGreaterThan(originalStat!.mtime.getTime())

          await expect(FileTime.assert(sessionID, filepath)).rejects.toThrow()
        },
      })
    })
  })
})
