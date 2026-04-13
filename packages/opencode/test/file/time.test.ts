import { afterEach, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { FileTime } from "../../src/file/time"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { Filesystem } from "../../src/util/filesystem"
import { provideInstance, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(Layer.mergeAll(FileTime.defaultLayer, CrossSpawnSpawner.defaultLayer))

const id = SessionID.make("ses_00000000000000000000000001")

const put = (file: string, text: string) => Effect.promise(() => fs.writeFile(file, text, "utf-8"))

const touch = (file: string, time: number) =>
  Effect.promise(() => {
    const date = new Date(time)
    return fs.utimes(file, date, date)
  })

const read = (id: SessionID, file: string) => FileTime.Service.use((svc) => svc.read(id, file))

const get = (id: SessionID, file: string) => FileTime.Service.use((svc) => svc.get(id, file))

const check = (id: SessionID, file: string) => FileTime.Service.use((svc) => svc.assert(id, file))

const lock = <A>(file: string, fn: () => Effect.Effect<A>) => FileTime.Service.use((svc) => svc.withLock(file, fn))

const fail = Effect.fn("FileTimeTest.fail")(function* <A, E, R>(self: Effect.Effect<A, E, R>) {
  const exit = yield* self.pipe(Effect.exit)
  if (Exit.isFailure(exit)) {
    const err = Cause.squash(exit.cause)
    return err instanceof Error ? err : new Error(String(err))
  }
  throw new Error("expected file time effect to fail")
})

describe("file/time", () => {
  describe("read() and get()", () => {
    it.live("stores read timestamp", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          yield* put(file, "content")

          const before = yield* get(id, file)
          expect(before).toBeUndefined()

          yield* read(id, file)

          const after = yield* get(id, file)
          expect(after).toBeInstanceOf(Date)
          expect(after!.getTime()).toBeGreaterThan(0)
        }),
      ),
    )

    it.live("tracks separate timestamps per session", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          yield* put(file, "content")

          const one = SessionID.make("ses_00000000000000000000000002")
          const two = SessionID.make("ses_00000000000000000000000003")
          yield* read(one, file)
          yield* read(two, file)

          const first = yield* get(one, file)
          const second = yield* get(two, file)

          expect(first).toBeDefined()
          expect(second).toBeDefined()
        }),
      ),
    )

    it.live("updates timestamp on subsequent reads", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          yield* put(file, "content")

          yield* read(id, file)
          const first = yield* get(id, file)

          yield* read(id, file)
          const second = yield* get(id, file)

          expect(second!.getTime()).toBeGreaterThanOrEqual(first!.getTime())
        }),
      ),
    )

    it.live("isolates reads by directory", () =>
      Effect.gen(function* () {
        const one = yield* tmpdirScoped()
        const two = yield* tmpdirScoped()
        const shared = yield* tmpdirScoped()
        const file = path.join(shared, "file.txt")
        yield* put(file, "content")

        yield* provideInstance(one)(read(id, file))
        const result = yield* provideInstance(two)(get(id, file))
        expect(result).toBeUndefined()
      }),
    )
  })

  describe("assert()", () => {
    it.live("passes when file has not been modified", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          yield* put(file, "content")
          yield* touch(file, 1_000)

          yield* read(id, file)
          yield* check(id, file)
        }),
      ),
    )

    it.live("throws when file was not read first", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          yield* put(file, "content")

          const err = yield* fail(check(id, file))
          expect(err.message).toContain("You must read file")
        }),
      ),
    )

    it.live("throws when file was modified after read", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          yield* put(file, "content")
          yield* touch(file, 1_000)

          yield* read(id, file)
          yield* put(file, "modified content")
          yield* touch(file, 2_000)

          const err = yield* fail(check(id, file))
          expect(err.message).toContain("modified since it was last read")
        }),
      ),
    )

    it.live("includes timestamps in error message", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          yield* put(file, "content")
          yield* touch(file, 1_000)

          yield* read(id, file)
          yield* put(file, "modified")
          yield* touch(file, 2_000)

          const err = yield* fail(check(id, file))
          expect(err.message).toContain("Last modification:")
          expect(err.message).toContain("Last read:")
        }),
      ),
    )
  })

  describe("withLock()", () => {
    it.live("executes function within lock", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          let hit = false

          yield* lock(file, () =>
            Effect.sync(() => {
              hit = true
              return "result"
            }),
          )

          expect(hit).toBe(true)
        }),
      ),
    )

    it.live("returns function result", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          const result = yield* lock(file, () => Effect.succeed("success"))
          expect(result).toBe("success")
        }),
      ),
    )

    it.live("serializes concurrent operations on same file", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          const order: number[] = []
          const hold = yield* Deferred.make<void>()
          const ready = yield* Deferred.make<void>()

          const one = yield* lock(file, () =>
            Effect.gen(function* () {
              order.push(1)
              yield* Deferred.succeed(ready, void 0)
              yield* Deferred.await(hold)
              order.push(2)
            }),
          ).pipe(Effect.forkScoped)

          yield* Deferred.await(ready)

          const two = yield* lock(file, () =>
            Effect.sync(() => {
              order.push(3)
              order.push(4)
            }),
          ).pipe(Effect.forkScoped)

          yield* Deferred.succeed(hold, void 0)
          yield* Fiber.join(one)
          yield* Fiber.join(two)

          expect(order).toEqual([1, 2, 3, 4])
        }),
      ),
    )

    it.live("allows concurrent operations on different files", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const onefile = path.join(dir, "file1.txt")
          const twofile = path.join(dir, "file2.txt")
          let one = false
          let two = false
          const hold = yield* Deferred.make<void>()
          const ready = yield* Deferred.make<void>()

          const a = yield* lock(onefile, () =>
            Effect.gen(function* () {
              one = true
              yield* Deferred.succeed(ready, void 0)
              yield* Deferred.await(hold)
              expect(two).toBe(true)
            }),
          ).pipe(Effect.forkScoped)

          yield* Deferred.await(ready)

          const b = yield* lock(twofile, () =>
            Effect.sync(() => {
              two = true
            }),
          ).pipe(Effect.forkScoped)

          yield* Fiber.join(b)
          yield* Deferred.succeed(hold, void 0)
          yield* Fiber.join(a)

          expect(one).toBe(true)
          expect(two).toBe(true)
        }),
      ),
    )

    it.live("releases lock even if function throws", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          const err = yield* fail(lock(file, () => Effect.die(new Error("Test error"))))
          expect(err.message).toContain("Test error")

          let hit = false
          yield* lock(file, () =>
            Effect.sync(() => {
              hit = true
            }),
          )
          expect(hit).toBe(true)
        }),
      ),
    )
  })

  describe("path normalization", () => {
    it.live("read with forward slashes, assert with backslashes", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          yield* put(file, "content")
          yield* touch(file, 1_000)

          const forward = file.replaceAll("\\", "/")
          yield* read(id, forward)
          yield* check(id, file)
        }),
      ),
    )

    it.live("read with backslashes, assert with forward slashes", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          yield* put(file, "content")
          yield* touch(file, 1_000)

          const forward = file.replaceAll("\\", "/")
          yield* read(id, file)
          yield* check(id, forward)
        }),
      ),
    )

    it.live("get returns timestamp regardless of slash direction", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          yield* put(file, "content")

          const forward = file.replaceAll("\\", "/")
          yield* read(id, forward)

          const result = yield* get(id, file)
          expect(result).toBeInstanceOf(Date)
        }),
      ),
    )

    it.live("withLock serializes regardless of slash direction", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          const forward = file.replaceAll("\\", "/")
          const order: number[] = []
          const hold = yield* Deferred.make<void>()
          const ready = yield* Deferred.make<void>()

          const one = yield* lock(file, () =>
            Effect.gen(function* () {
              order.push(1)
              yield* Deferred.succeed(ready, void 0)
              yield* Deferred.await(hold)
              order.push(2)
            }),
          ).pipe(Effect.forkScoped)

          yield* Deferred.await(ready)

          const two = yield* lock(forward, () =>
            Effect.sync(() => {
              order.push(3)
              order.push(4)
            }),
          ).pipe(Effect.forkScoped)

          yield* Deferred.succeed(hold, void 0)
          yield* Fiber.join(one)
          yield* Fiber.join(two)

          expect(order).toEqual([1, 2, 3, 4])
        }),
      ),
    )
  })

  describe("stat() Filesystem.stat pattern", () => {
    it.live("reads file modification time via Filesystem.stat()", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          yield* put(file, "content")
          yield* touch(file, 1_000)

          yield* read(id, file)

          const stat = Filesystem.stat(file)
          expect(stat?.mtime).toBeInstanceOf(Date)
          expect(stat!.mtime.getTime()).toBeGreaterThan(0)

          yield* check(id, file)
        }),
      ),
    )

    it.live("detects modification via stat mtime", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "file.txt")
          yield* put(file, "original")
          yield* touch(file, 1_000)

          yield* read(id, file)

          const first = Filesystem.stat(file)

          yield* put(file, "modified")
          yield* touch(file, 2_000)

          const second = Filesystem.stat(file)
          expect(second!.mtime.getTime()).toBeGreaterThan(first!.mtime.getTime())

          yield* fail(check(id, file))
        }),
      ),
    )
  })
})
