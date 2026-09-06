import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { Environment } from "@opencode-ai/core/environment/index"
import { Location } from "@opencode-ai/core/location"
import { FileAccess } from "@opencode-ai/core/file-access"
import { Permission } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { type EnvironmentFilesTransform, transformEnvironmentFiles } from "./fixture/environment"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"

function provide(directory: string, transformFiles: EnvironmentFilesTransform = () => ({})) {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.provide(
    AppNodeBuilder.build(LayerNode.group([FileAccess.node, FileMutation.node]), [
      Location.node.replace(activeLocation),
      Permission.node.replace(permissionLayer()),
      Environment.node.replace(transformEnvironmentFiles(transformFiles)),
    ]),
  )
}

describe("FileMutation", () => {
  it.live("writes an existing internal file and returns a stable result", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "hello.txt")
        yield* Effect.promise(() => fs.writeFile(targetPath, "before"))
        const access = yield* FileAccess.Service
        const target = yield* access.resolve({ path: "hello.txt" })

        expect(yield* (yield* FileMutation.Service).write({ target, content: "after" })).toEqual({
          operation: "write",
          target: target.absolute,
          resource: "hello.txt",
          existed: true,
        })
        expect(yield* Effect.promise(() => fs.readFile(targetPath, "utf8"))).toBe("after")
      }).pipe(provide(directory)),
    ),
  )

  it.live("writes a prospective internal file and creates parent directories", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const access = yield* FileAccess.Service
        const target = yield* access.resolve({
          path: path.join("src", "nested", "hello.txt"),
        })
        const result = yield* (yield* FileMutation.Service).write({ target, content: "hello" })

        expect(result).toEqual({
          operation: "write",
          target: target.absolute,
          resource: "src/nested/hello.txt",
          existed: false,
        })
        expect(yield* Effect.promise(() => fs.readFile(target.absolute, "utf8"))).toBe("hello")
      }).pipe(provide(directory)),
    ),
  )

  it.live("preserves exactly one BOM for text writes and normalizes created text", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const preservedPath = path.join(directory, "preserved.txt")
        yield* Effect.promise(() => fs.writeFile(preservedPath, "\uFEFFbefore"))
        const access = yield* FileAccess.Service
        const preserved = yield* access.resolve({ path: "preserved.txt" })
        const created = yield* access.resolve({ path: "created.txt" })
        const files = yield* FileMutation.Service

        yield* files.writeTextPreservingBom({ target: preserved, content: "\uFEFFafter" })
        yield* files.writeTextPreservingBom({ target: created, content: "\uFEFF\uFEFF\uFEFFcreated" })

        expect(yield* Effect.promise(() => fs.readFile(preservedPath, "utf8"))).toBe("\uFEFFafter")
        expect(yield* Effect.promise(() => fs.readFile(created.absolute, "utf8"))).toBe("\uFEFFcreated")
      }).pipe(provide(directory)),
    ),
  )

  it.live("writes an explicitly resolved external target", () =>
    withTempDir(({ path: directory }) =>
      withTempDir(({ path: outside }) =>
        Effect.gen(function* () {
          const targetPath = path.join(outside, "external.txt")
          const access = yield* FileAccess.Service
          const target = yield* access.resolve({ path: targetPath })
          const result = yield* (yield* FileMutation.Service).write({ target, content: "external" })

          expect(result).toEqual({
            operation: "write",
            target: target.absolute,
            resource: target.resource,
            existed: false,
          })
          expect(yield* Effect.promise(() => fs.readFile(targetPath, "utf8"))).toBe("external")
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("serializes concurrent writes to the same absolute target", () =>
    withTempDir(({ path: directory }) =>
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
          const access = yield* FileAccess.Service
          const files = yield* FileMutation.Service
          const firstPlan = yield* access.resolve({ path: "shared.txt" })
          const secondPlan = yield* access.resolve({ path: "shared.txt" })
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

  it.live("shares transaction locks across Location service instances", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const target = path.join(directory, "shared.txt")
        const first = yield* Effect.gen(function* () {
          const files = yield* FileMutation.Service
          yield* files.withLock([target])(
            Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst))),
          )
        }).pipe(provide(directory), Effect.forkChild)
        yield* Deferred.await(firstStarted)
        const second = yield* Effect.gen(function* () {
          const files = yield* FileMutation.Service
          yield* files.withLock([target])(Deferred.succeed(secondStarted, undefined))
        }).pipe(provide(directory), Effect.forkChild)
        yield* Effect.yieldNow
        expect(yield* Deferred.isDone(secondStarted)).toBe(false)

        yield* Deferred.succeed(releaseFirst, undefined)
        yield* Deferred.await(secondStarted)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
      }),
    ),
  )

  it.live("allows transaction locks for distinct resolved paths to proceed independently", () =>
    withTempDir(({ path: directory }) =>
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const secondFinished = yield* Deferred.make<void>()
        const files = yield* FileMutation.Service
        const first = yield* files
          .withLock([path.join(directory, "first.txt")])(
            Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst))),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        yield* files.withLock([path.join(directory, "second.txt")])(Deferred.succeed(secondFinished, undefined))
        expect(yield* Deferred.isDone(secondFinished)).toBe(true)

        yield* Deferred.succeed(releaseFirst, undefined)
        yield* Fiber.join(first)
      }).pipe(provide(directory)),
    ),
  )

  it.live("allows distinct absolute targets to proceed independently", () =>
    withTempDir(({ path: directory }) =>
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
          const access = yield* FileAccess.Service
          const files = yield* FileMutation.Service
          const firstPlan = yield* access.resolve({ path: "first.txt" })
          const secondPlan = yield* access.resolve({ path: "second.txt" })
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

function instrumentWrites(
  run: <E>(write: Effect.Effect<void, E>, target: string) => Effect.Effect<void, E>,
): EnvironmentFilesTransform {
  return (files) => ({ write: (target, content) => run(files.write(target, content), target) })
}
