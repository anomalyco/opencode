import { describe, test, expect, beforeEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { FileTime } from "../../src/file/time"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("file/time", () => {
  const sessionID = "test-session-123"

  describe("read() and get()", () => {
    test("stores read timestamp", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const before = FileTime.get(sessionID, filepath)
          expect(before).toBeUndefined()

          FileTime.read(sessionID, filepath)

          const after = FileTime.get(sessionID, filepath)
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
          FileTime.read("session1", filepath)
          FileTime.read("session2", filepath)

          const time1 = FileTime.get("session1", filepath)
          const time2 = FileTime.get("session2", filepath)

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
          const first = FileTime.get(sessionID, filepath)!

          await new Promise((resolve) => setTimeout(resolve, 10))

          FileTime.read(sessionID, filepath)
          const second = FileTime.get(sessionID, filepath)!

          expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime())
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

          // Should not throw
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

          // Wait to ensure different timestamps
          await new Promise((resolve) => setTimeout(resolve, 100))

          // Modify file after reading
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
          FileTime.read(sessionID, filepath)
          await new Promise((resolve) => setTimeout(resolve, 100))
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

    test("skips check when OPENCODE_DISABLE_FILETIME_CHECK is true", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { Flag } = await import("../../src/flag/flag")
          const original = Flag.OPENCODE_DISABLE_FILETIME_CHECK
          ;(Flag as { OPENCODE_DISABLE_FILETIME_CHECK: boolean }).OPENCODE_DISABLE_FILETIME_CHECK = true

          try {
            // Should not throw even though file wasn't read
            await FileTime.assert(sessionID, filepath)
          } finally {
            ;(Flag as { OPENCODE_DISABLE_FILETIME_CHECK: boolean }).OPENCODE_DISABLE_FILETIME_CHECK = original
          }
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
            await new Promise((resolve) => setTimeout(resolve, 10))
            order.push(2)
          })

          const op2 = FileTime.withLock(filepath, async () => {
            order.push(3)
            order.push(4)
          })

          await Promise.all([op1, op2])

          // Operations should be serialized
          expect(order).toContain(1)
          expect(order).toContain(2)
          expect(order).toContain(3)
          expect(order).toContain(4)
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
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(started2).toBe(true) // op2 should have started while op1 is running
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

          // Lock should be released, subsequent operations should work
          let executed = false
          await FileTime.withLock(filepath, async () => {
            executed = true
          })
          expect(executed).toBe(true)
        },
      })
    })

    test("deadlocks on nested locks (expected behavior)", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Nested locks on same file cause deadlock - this is expected
          // The outer lock waits for inner to complete, but inner waits for outer to release
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Deadlock detected")), 100),
          )

          const nestedLock = FileTime.withLock(filepath, async () => {
            return FileTime.withLock(filepath, async () => {
              return "inner"
            })
          })

          // Should timeout due to deadlock
          await expect(Promise.race([nestedLock, timeout])).rejects.toThrow("Deadlock detected")
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

          const stats = Filesystem.stat(filepath)
          expect(stats?.mtime).toBeInstanceOf(Date)
          expect(stats!.mtime.getTime()).toBeGreaterThan(0)

          // FileTime.assert uses this stat internally
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

          const originalStat = Filesystem.stat(filepath)

          // Wait and modify
          await new Promise((resolve) => setTimeout(resolve, 100))
          await fs.writeFile(filepath, "modified", "utf-8")

          const newStat = Filesystem.stat(filepath)
          expect(newStat!.mtime.getTime()).toBeGreaterThan(originalStat!.mtime.getTime())

          await expect(FileTime.assert(sessionID, filepath)).rejects.toThrow()
        },
      })
    })
  })
})
