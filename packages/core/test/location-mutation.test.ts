import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { location } from "./fixture/location"
import { it } from "./lib/effect"

function provide(directory: string) {
  return Effect.provide(
    LocationMutation.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          FSUtil.defaultLayer,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
      ),
    ),
  )
}

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

describe("LocationMutation", () => {
  it.live("resolves an active relative existing file target", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "hello.txt")
        yield* Effect.promise(() => fs.writeFile(targetPath, "hello"))
        const plan = yield* (yield* LocationMutation.Service).resolve({ path: "hello.txt" })

        expect(plan.target).toMatchObject({
          canonical: yield* Effect.promise(() => fs.realpath(targetPath)),
          exists: true,
          resource: "hello.txt",
        })
        expect(plan.target.externalDirectory).toBeUndefined()
        expect(yield* (yield* LocationMutation.Service).revalidate(plan)).toMatchObject({
          canonical: plan.target.canonical,
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("resolves an active relative prospective file target", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        const plan = yield* (yield* LocationMutation.Service).resolve({ path: path.join("src", "new.txt") })
        const root = yield* Effect.promise(() => fs.realpath(directory))

        expect(plan.target).toMatchObject({
          canonical: path.join(root, "src", "new.txt"),
          exists: false,
          resource: "src/new.txt",
        })
        expect(plan.authority.canonical).toBe(path.join(root, "src"))
        expect(yield* (yield* LocationMutation.Service).revalidate(plan)).toMatchObject({
          canonical: plan.target.canonical,
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects a relative lexical escape instead of promoting it to external authority", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip((yield* LocationMutation.Service).resolve({ path: "../outside.txt" }))
        expect(error).toMatchObject({ _tag: "LocationMutation.PathError", reason: "relative_escape" })
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects a prospective target below an escaping symlink ancestor", () =>
    withTmp((directory) => {
      const outside = `${directory}-outside`
      return Effect.gen(function* () {
        if (process.platform === "win32") return
        yield* Effect.promise(async () => {
          await fs.mkdir(outside)
          await fs.symlink(outside, path.join(directory, "escape"))
        })
        const error = yield* Effect.flip(
          (yield* LocationMutation.Service).resolve({ path: path.join("escape", "new.txt") }),
        )
        expect(error).toMatchObject({ _tag: "LocationMutation.PathError", reason: "location_escape" })
        yield* Effect.promise(() => fs.rm(outside, { recursive: true, force: true }))
      }).pipe(provide(directory))
    }),
  )

  it.live("accepts an explicit absolute in-location target without external approval", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "new.txt")
        const plan = yield* (yield* LocationMutation.Service).resolve({ path: targetPath })
        expect(plan.target).toMatchObject({
          canonical: path.join(yield* Effect.promise(() => fs.realpath(directory)), "new.txt"),
          resource: "new.txt",
        })
        expect(plan.target.externalDirectory).toBeUndefined()
      }).pipe(provide(directory)),
    ),
  )

  it.live("requires external-directory authorization for an explicit external absolute target", () =>
    withTmp((directory) =>
      withTmp((outside) =>
        Effect.gen(function* () {
          const targetPath = path.join(outside, "new.txt")
          const plan = yield* (yield* LocationMutation.Service).resolve({ path: targetPath })
          const root = yield* Effect.promise(() => fs.realpath(outside))
          expect(plan.target).toMatchObject({
            canonical: path.join(root, "new.txt"),
            resource: path.join(root, "new.txt").replaceAll("\\", "/"),
          })
          expect(plan.target.externalDirectory).toMatchObject({
            directory: root,
            resource: path.join(root, "*").replaceAll("\\", "/"),
          })
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("resolves an existing external file target", () =>
    withTmp((directory) =>
      withTmp((outside) =>
        Effect.gen(function* () {
          const targetPath = path.join(outside, "existing.txt")
          yield* Effect.promise(() => fs.writeFile(targetPath, "existing"))
          const plan = yield* (yield* LocationMutation.Service).resolve({ path: targetPath })
          const root = yield* Effect.promise(() => fs.realpath(outside))
          expect(plan.target).toMatchObject({ canonical: path.join(root, "existing.txt"), exists: true })
          expect(plan.authority.canonical).toBe(path.join(root, "existing.txt"))
          expect(plan.target.externalDirectory?.directory).toBe(root)
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("anchors prospective external descendants at their stable existing directory", () =>
    withTmp((directory) =>
      withTmp((outside) =>
        Effect.gen(function* () {
          const targetPath = path.join(outside, "new", "nested", "file.txt")
          const plan = yield* (yield* LocationMutation.Service).resolve({ path: targetPath })
          const root = yield* Effect.promise(() => fs.realpath(outside))
          expect(plan.authority.canonical).toBe(root)
          expect(plan.target.externalDirectory).toMatchObject({
            directory: root,
            resource: path.join(root, "*").replaceAll("\\", "/"),
          })
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("rejects a symlink-ancestor swap during post-approval revalidation", () =>
    withTmp((directory) =>
      withTmp((outside) =>
        Effect.gen(function* () {
          if (process.platform === "win32") return
          const parent = path.join(directory, "parent")
          yield* Effect.promise(() => fs.mkdir(parent))
          const service = yield* LocationMutation.Service
          const plan = yield* service.resolve({ path: path.join("parent", "new.txt") })
          yield* Effect.promise(async () => {
            await fs.rmdir(parent)
            await fs.symlink(outside, parent)
          })

          const error = yield* Effect.flip(service.revalidate(plan))
          expect(error).toMatchObject({ _tag: "LocationMutation.RevalidationError" })
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("rejects an existing target identity swap during post-approval revalidation", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "existing.txt")
        yield* Effect.promise(() => fs.writeFile(targetPath, "first"))
        const service = yield* LocationMutation.Service
        const plan = yield* service.resolve({ path: "existing.txt" })
        yield* Effect.promise(async () => {
          const replacementPath = path.join(directory, "replacement.txt")
          await fs.writeFile(replacementPath, "second")
          await fs.rm(targetPath)
          await fs.rename(replacementPath, targetPath)
        })

        const error = yield* Effect.flip(service.revalidate(plan))
        expect(error).toMatchObject({
          _tag: "LocationMutation.RevalidationError",
          reason: "mutation authority changed",
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects a nearer prospective ancestor introduced after approval", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const service = yield* LocationMutation.Service
        const plan = yield* service.resolve({ path: path.join("new", "nested", "file.txt") })
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "new")))

        const error = yield* Effect.flip(service.revalidate(plan))
        expect(error).toMatchObject({
          _tag: "LocationMutation.RevalidationError",
          reason: "mutation authority changed",
        })
      }).pipe(provide(directory)),
    ),
  )

  test("keeps project references outside the mutation input API", () => {
    expect(Object.keys(LocationMutation.ResolveInput.fields)).toEqual(["path", "kind"])
    expect(Schema.decodeUnknownSync(LocationMutation.ResolveInput)({ path: "README.md", reference: "docs" })).toEqual({
      path: "README.md",
    })
  })
})
