import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

function provide(directory: string, filesystem = FSUtil.defaultLayer) {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  const resolution = LocationMutation.layer.pipe(Layer.provide(filesystem), Layer.provide(activeLocation))
  const mutation = FileMutation.layer.pipe(Layer.provide(filesystem))
  return Effect.provide(Layer.mergeAll(resolution, mutation))
}

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

describe("FileMutation", () => {
  it.live("writes an existing internal file and returns a stable result", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "hello.txt")
        yield* Effect.promise(() => fs.writeFile(targetPath, "before"))
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "hello.txt" })

        expect(yield* (yield* FileMutation.Service).write({ target, content: "after" })).toEqual({
          operation: "write",
          target: target.canonical,
          resource: "hello.txt",
          existed: true,
        })
        expect(yield* Effect.promise(() => fs.readFile(targetPath, "utf8"))).toBe("after")
      }).pipe(provide(directory)),
    ),
  )

  it.live("writes a prospective internal file and creates parent directories", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const target = yield* (yield* LocationMutation.Service).resolve({
          path: path.join("src", "nested", "hello.txt"),
        })
        const result = yield* (yield* FileMutation.Service).write({ target, content: "hello" })

        expect(result).toEqual({
          operation: "write",
          target: target.canonical,
          resource: "src/nested/hello.txt",
          existed: false,
        })
        expect(yield* Effect.promise(() => fs.readFile(result.target, "utf8"))).toBe("hello")
      }).pipe(provide(directory)),
    ),
  )

  it.live("preserves exactly one BOM for text writes and normalizes created text", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const preservedPath = path.join(directory, "preserved.txt")
        yield* Effect.promise(() => fs.writeFile(preservedPath, "\uFEFFbefore"))
        const preserved = yield* (yield* LocationMutation.Service).resolve({ path: "preserved.txt" })
        const created = yield* (yield* LocationMutation.Service).resolve({ path: "created.txt" })
        const files = yield* FileMutation.Service

        yield* files.writeTextPreservingBom({ target: preserved, content: "\uFEFFafter" })
        yield* files.writeTextPreservingBom({ target: created, content: "\uFEFF\uFEFF\uFEFFcreated" })

        expect(yield* Effect.promise(() => fs.readFile(preservedPath, "utf8"))).toBe("\uFEFFafter")
        expect(yield* Effect.promise(() => fs.readFile(created.canonical, "utf8"))).toBe("\uFEFFcreated")
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects create when a prospective target appears after resolution", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "appeared.txt")
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "appeared.txt" })
        yield* Effect.promise(() => fs.writeFile(targetPath, "winner"))

        expect(
          yield* (yield* FileMutation.Service).create({ target, content: "replacement" }).pipe(Effect.flip),
        ).toMatchObject({
          _tag: "FileMutation.TargetExistsError",
        })
        expect(yield* Effect.promise(() => fs.readFile(targetPath, "utf8"))).toBe("winner")
      }).pipe(provide(directory)),
    ),
  )

  it.live("creates when an existing target disappears after resolution", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "removed.txt")
        yield* Effect.promise(() => fs.writeFile(targetPath, "before"))
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "removed.txt" })
        yield* Effect.promise(() => fs.rm(targetPath))

        expect(yield* (yield* FileMutation.Service).create({ target, content: "after" })).toEqual({
          operation: "write",
          target: target.canonical,
          resource: "removed.txt",
          existed: false,
        })
        expect(yield* Effect.promise(() => fs.readFile(targetPath, "utf8"))).toBe("after")
      }).pipe(provide(directory)),
    ),
  )

  it.live("removes an existing internal file", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "remove.txt")
        yield* Effect.promise(() => fs.writeFile(targetPath, "remove"))
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "remove.txt" })
        const result = yield* (yield* FileMutation.Service).remove({ target })

        expect(result).toEqual({
          operation: "remove",
          target: target.canonical,
          resource: "remove.txt",
          existed: true,
        })
        expect(
          yield* Effect.promise(() =>
            fs.stat(targetPath).then(
              () => true,
              () => false,
            ),
          ),
        ).toBe(false)
      }).pipe(provide(directory)),
    ),
  )

  it.live("writes an explicitly resolved external target", () =>
    withTmp((directory) =>
      withTmp((outside) =>
        Effect.gen(function* () {
          const targetPath = path.join(outside, "external.txt")
          const target = yield* (yield* LocationMutation.Service).resolve({ path: targetPath })
          const result = yield* (yield* FileMutation.Service).write({ target, content: "external" })

          expect(result).toEqual({
            operation: "write",
            target: target.canonical,
            resource: target.resource,
            existed: false,
          })
          expect(yield* Effect.promise(() => fs.readFile(targetPath, "utf8"))).toBe("external")
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("removes an explicitly resolved external target", () =>
    withTmp((directory) =>
      withTmp((outside) =>
        Effect.gen(function* () {
          const targetPath = path.join(outside, "external.txt")
          yield* Effect.promise(() => fs.writeFile(targetPath, "external"))
          const target = yield* (yield* LocationMutation.Service).resolve({ path: targetPath })
          const result = yield* (yield* FileMutation.Service).remove({ target })

          expect(result).toEqual({
            operation: "remove",
            target: target.canonical,
            resource: target.resource,
            existed: true,
          })
          expect(
            yield* Effect.promise(() =>
              fs.stat(targetPath).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("reports a missing target as not removed without checking existence first", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "missing.txt" })

        expect(yield* (yield* FileMutation.Service).remove({ target })).toEqual({
          operation: "remove",
          target: target.canonical,
          resource: "missing.txt",
          existed: false,
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("serializes concurrent writes to the same canonical target", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "shared.txt")
        yield* Effect.promise(() => fs.writeFile(targetPath, "initial"))
        const firstStarted = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let writes = 0
        const filesystem = instrumentWrites((write) =>
          Effect.gen(function* () {
            writes++
            if (writes === 1) {
              yield* Deferred.succeed(firstStarted, undefined)
              yield* Deferred.await(releaseFirst)
            } else {
              yield* Deferred.succeed(secondStarted, undefined)
            }
            yield* write
          }),
        )

        yield* Effect.gen(function* () {
          const mutation = yield* LocationMutation.Service
          const files = yield* FileMutation.Service
          const firstPlan = yield* mutation.resolve({ path: "shared.txt" })
          const secondPlan = yield* mutation.resolve({ path: "shared.txt" })
          const first = yield* files.write({ target: firstPlan, content: "first" }).pipe(Effect.forkChild)
          yield* Deferred.await(firstStarted)
          const second = yield* files.write({ target: secondPlan, content: "second" }).pipe(Effect.forkChild)
          yield* Effect.yieldNow
          expect(yield* Deferred.isDone(secondStarted)).toBe(false)

          yield* Deferred.succeed(releaseFirst, undefined)
          yield* Deferred.await(secondStarted)
          yield* Fiber.join(first)
          yield* Fiber.join(second)
          expect(yield* Effect.promise(() => fs.readFile(targetPath, "utf8"))).toBe("second")
        }).pipe(provide(directory, filesystem))
      }),
    ),
  )

  it.live("allows only one concurrent conditional write based on the same bytes", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "shared.txt")
        yield* Effect.promise(() => fs.writeFile(targetPath, "initial"))
        const firstStarted = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        let writes = 0
        const filesystem = instrumentWrites((write) =>
          Effect.gen(function* () {
            writes++
            if (writes === 1) {
              yield* Deferred.succeed(firstStarted, undefined)
              yield* Deferred.await(releaseFirst)
            }
            yield* write
          }),
        )

        yield* Effect.gen(function* () {
          const mutation = yield* LocationMutation.Service
          const files = yield* FileMutation.Service
          const target = yield* mutation.resolve({ path: "shared.txt" })
          const expected = new TextEncoder().encode("initial")
          const first = yield* files.writeIfUnchanged({ target, expected, content: "first" }).pipe(Effect.forkChild)
          yield* Deferred.await(firstStarted)
          const second = yield* files
            .writeIfUnchanged({ target, expected, content: "second" })
            .pipe(Effect.flip, Effect.forkChild)

          yield* Deferred.succeed(releaseFirst, undefined)
          yield* Fiber.join(first)
          expect(yield* Fiber.join(second)).toMatchObject({ _tag: "FileMutation.StaleContentError" })
          expect(yield* Effect.promise(() => fs.readFile(targetPath, "utf8"))).toBe("first")
          expect(writes).toBe(1)
        }).pipe(provide(directory, filesystem))
      }),
    ),
  )

  it.live("rejects a conditional write when target content is already stale", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "stale.txt")
        yield* Effect.promise(() => fs.writeFile(targetPath, "current"))
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "stale.txt" })

        expect(
          yield* (yield* FileMutation.Service)
            .writeIfUnchanged({ target, expected: new TextEncoder().encode("older"), content: "replacement" })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "FileMutation.StaleContentError", path: target.canonical })
        expect(yield* Effect.promise(() => fs.readFile(targetPath, "utf8"))).toBe("current")
      }).pipe(provide(directory)),
    ),
  )

  it.live("allows distinct canonical targets to proceed independently", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const secondFinished = yield* Deferred.make<void>()
        const secondPath = path.join(directory, "second.txt")
        let writes = 0
        const filesystem = instrumentWrites((write) =>
          ++writes === 1
            ? Deferred.succeed(firstStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseFirst)),
                Effect.andThen(write),
              )
            : write.pipe(Effect.andThen(Deferred.succeed(secondFinished, undefined))),
        )

        yield* Effect.gen(function* () {
          const mutation = yield* LocationMutation.Service
          const files = yield* FileMutation.Service
          const firstPlan = yield* mutation.resolve({ path: "first.txt" })
          const secondPlan = yield* mutation.resolve({ path: "second.txt" })
          const first = yield* files.write({ target: firstPlan, content: "first" }).pipe(Effect.forkChild)
          yield* Deferred.await(firstStarted)
          const second = yield* files.write({ target: secondPlan, content: "second" }).pipe(Effect.forkChild)
          yield* Deferred.await(secondFinished)
          expect(yield* Effect.promise(() => fs.readFile(secondPath, "utf8"))).toBe("second")

          yield* Deferred.succeed(releaseFirst, undefined)
          yield* Fiber.join(first)
          yield* Fiber.join(second)
        }).pipe(provide(directory, filesystem))
      }),
    ),
  )
})

function instrumentWrites(run: <E>(write: Effect.Effect<void, E>, target: string) => Effect.Effect<void, E>) {
  return Layer.effect(
    FSUtil.Service,
    Effect.gen(function* () {
      const filesystem = yield* FSUtil.Service
      return FSUtil.Service.of({
        ...filesystem,
        writeWithDirs: (target, content, mode) => run(filesystem.writeWithDirs(target, content, mode), target),
        writeFile: (target, content, options) => run(filesystem.writeFile(target, content, options), target),
        writeFileString: (target, content, options) =>
          run(filesystem.writeFileString(target, content, options), target),
      })
    }),
  ).pipe(Layer.provide(FSUtil.defaultLayer))
}
