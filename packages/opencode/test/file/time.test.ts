import { afterAll, afterEach, describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, ManagedRuntime } from "effect"
import { FileTime } from "../../src/file/time"
import { attach } from "../../src/effect/run-service"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

const runtime = ManagedRuntime.make(FileTime.defaultLayer)

afterAll(async () => {
  await runtime.dispose()
})

afterEach(async () => {
  await Instance.disposeAll()
})

const run = <A>(effect: Effect.Effect<A, any, FileTime.Service>) =>
  runtime.runPromise(attach(effect))

const read = (sessionID: SessionID, file: string) =>
  run(FileTime.Service.use((ft) => ft.read(sessionID, file)))

const get = (sessionID: SessionID, file: string) =>
  run(FileTime.Service.use((ft) => ft.get(sessionID, file)))

const assert = (sessionID: SessionID, filepath: string) =>
  run(FileTime.Service.use((ft) => ft.assert(sessionID, filepath)))

const withLock = <T>(filepath: string, fn: () => Effect.Effect<T>) =>
  run(FileTime.Service.use((ft) => ft.withLock(filepath, fn)))

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
          const before = await get(sessionID, filepath)
          expect(before).toBeUndefined()

          await read(sessionID, filepath)

          const after = await get(sessionID, filepath)
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
          await read(SessionID.make("ses_00000000000000000000000002"), filepath)
          await read(SessionID.make("ses_00000000000000000000000003"), filepath)

          const time1 = await get(SessionID.make("ses_00000000000000000000000002"), filepath)
          const time2 = await get(SessionID.make("ses_00000000000000000000000003"), filepath)

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
          await read(sessionID, filepath)
          const first = await get(sessionID, filepath)

          await read(sessionID, filepath)
          const second = await get(sessionID, filepath)

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
          await read(sessionID, filepath)
        },
      })

      await Instance.provide({
        directory: two.path,
        fn: async () => {
          expect(await get(sessionID, filepath)).toBeUndefined()
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
          await read(sessionID, filepath)
          await assert(sessionID, filepath)
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
          await expect(assert(sessionID, filepath)).rejects.toThrow("You must read file")
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
          await read(sessionID, filepath)
          await fs.writeFile(filepath, "modified content", "utf-8")
          await touch(filepath, 2_000)
          await expect(assert(sessionID, filepath)).rejects.toThrow("modified since it was last read")
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
          await read(sessionID, filepath)
          await fs.writeFile(filepath, "modified", "utf-8")
          await touch(filepath, 2_000)

          let error: Error | undefined
          try {
            await assert(sessionID, filepath)
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
          await withLock(filepath, () => {
            executed = true
            return Effect.succeed("result")
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
          const result = await withLock(filepath, () => Effect.succeed("success"))
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

          const op1 = withLock(filepath, () =>
            Effect.gen(function* () {
              order.push(1)
              ready.open()
              yield* Effect.promise(() => hold.wait)
              order.push(2)
            }),
          )

          await ready.wait

          const op2 = withLock(filepath, () =>
            Effect.gen(function* () {
              order.push(3)
              order.push(4)
            }),
          )

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

          const op1 = withLock(filepath1, () =>
            Effect.gen(function* () {
              started1 = true
              ready.open()
              yield* Effect.promise(() => hold.wait)
              expect(started2).toBe(true)
            }),
          )

          await ready.wait

          const op2 = withLock(filepath2, () =>
            Effect.gen(function* () {
              started2 = true
              hold.open()
            }),
          )

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
            withLock(filepath, () => Effect.die(new Error("Test error"))),
          ).rejects.toThrow("Test error")

          let executed = false
          await withLock(filepath, () => {
            executed = true
            return Effect.void
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
          await read(sessionID, forwardSlash)
          // assert with the native backslash path should still work
          await assert(sessionID, filepath)
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
          await read(sessionID, filepath)
          // assert with forward slashes should still work
          await assert(sessionID, forwardSlash)
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
          await read(sessionID, forwardSlash)
          const result = await get(sessionID, filepath)
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

          const op1 = withLock(filepath, () =>
            Effect.gen(function* () {
              order.push(1)
              ready.open()
              yield* Effect.promise(() => hold.wait)
              order.push(2)
            }),
          )

          await ready.wait

          // Use forward-slash variant -- should still serialize against op1
          const op2 = withLock(forwardSlash, () =>
            Effect.gen(function* () {
              order.push(3)
              order.push(4)
            }),
          )

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
          await read(sessionID, filepath)

          const stats = Filesystem.stat(filepath)
          expect(stats?.mtime).toBeInstanceOf(Date)
          expect(stats!.mtime.getTime()).toBeGreaterThan(0)

          await assert(sessionID, filepath)
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
          await read(sessionID, filepath)

          const originalStat = Filesystem.stat(filepath)

          await fs.writeFile(filepath, "modified", "utf-8")
          await touch(filepath, 2_000)

          const newStat = Filesystem.stat(filepath)
          expect(newStat!.mtime.getTime()).toBeGreaterThan(originalStat!.mtime.getTime())

          await expect(assert(sessionID, filepath)).rejects.toThrow()
        },
      })
    })
  })
})
