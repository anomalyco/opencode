import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Environment } from "@opencode-ai/core/environment/index"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Workspace } from "@opencode-ai/core/workspace"
import { tmpdir } from "./fixture/tmpdir"
import { hostEnvironmentLayer } from "./fixture/environment"
import { location } from "./fixture/location"
import { it } from "./lib/effect"

function provide(directory: string) {
  return Effect.provide(
    LayerNode.compile(LocationMutation.node, [
      [
        Location.node,
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
      ],
      [Environment.node, hostEnvironmentLayer],
    ]),
  )
}

function provideMemory(directory: string, memory: Environment.MemoryDriver) {
  return Effect.provide(
    LayerNode.compile(LocationMutation.node, [
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of(
            location({ directory: AbsolutePath.make(directory), workspaceID: Workspace.ID.make("wrk_test") }),
          ),
        ),
      ],
      [
        Environment.node,
        Layer.succeed(
          Environment.Service,
          Environment.Service.of({ files: Environment.makeFiles(memory), spawner: memory.spawner }),
        ),
      ],
    ]),
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
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "hello.txt" })

        expect(target).toMatchObject({
          absolute: targetPath,
          resource: "hello.txt",
        })
        expect(target.externalDirectory).toBeUndefined()
      }).pipe(provide(directory)),
    ),
  )

  it.live("resolves an active relative prospective file target", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        const target = yield* (yield* LocationMutation.Service).resolve({ path: path.join("src", "new.txt") })
        expect(target).toMatchObject({
          absolute: path.join(directory, "src", "new.txt"),
          resource: "src/new.txt",
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("requires external-directory authorization for a relative lexical escape", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "../outside.txt" })
        const root = path.dirname(directory)
        expect(target).toMatchObject({
          absolute: path.join(root, "outside.txt"),
          resource: path.join(root, "outside.txt").replaceAll("\\", "/"),
        })
        expect(target.externalDirectory).toMatchObject({
          directory: root,
          resource: path.join(root, "*").replaceAll("\\", "/"),
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("resolves a prospective target below an external symlink lexically", () =>
    withTmp((directory) => {
      const outside = `${directory}-outside`
      return Effect.gen(function* () {
        if (process.platform === "win32") return
        yield* Effect.promise(async () => {
          await fs.mkdir(outside)
          await fs.symlink(outside, path.join(directory, "escape"))
        })
        const target = yield* (yield* LocationMutation.Service).resolve({ path: path.join("escape", "new.txt") })
        expect(target).toMatchObject({
          absolute: path.join(directory, "escape", "new.txt"),
          resource: "escape/new.txt",
        })
        expect(target.externalDirectory).toBeUndefined()
        yield* Effect.promise(() => fs.rm(outside, { recursive: true, force: true }))
      }).pipe(provide(directory))
    }),
  )

  it.live("follows an in-location symlink using ordinary filesystem semantics", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        if (process.platform === "win32") return
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(directory, "actual"))
          await fs.symlink(path.join(directory, "actual"), path.join(directory, "linked"))
        })

        expect(yield* (yield* LocationMutation.Service).resolve({ path: "linked/new.txt" })).toMatchObject({
          absolute: path.join(directory, "linked", "new.txt"),
          resource: "linked/new.txt",
        })
      }).pipe(provide(directory)),
    ),
  )

  it.live("accepts an explicit absolute in-location target without external approval", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const targetPath = path.join(directory, "new.txt")
        const target = yield* (yield* LocationMutation.Service).resolve({ path: targetPath })
        expect(target).toMatchObject({
          absolute: targetPath,
          resource: "new.txt",
        })
        expect(target.externalDirectory).toBeUndefined()
      }).pipe(provide(directory)),
    ),
  )

  it.live("requires external-directory authorization for an explicit external absolute target", () =>
    withTmp((directory) =>
      withTmp((outside) =>
        Effect.gen(function* () {
          const targetPath = path.join(outside, "new.txt")
          const target = yield* (yield* LocationMutation.Service).resolve({ path: targetPath })
          const root = outside
          expect(target).toMatchObject({
            absolute: path.join(root, "new.txt"),
            resource: path.join(root, "new.txt").replaceAll("\\", "/"),
          })
          expect(target.externalDirectory).toMatchObject({
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
          const target = yield* (yield* LocationMutation.Service).resolve({ path: targetPath })
          expect(target).toMatchObject({ absolute: targetPath })
          expect(target.externalDirectory?.directory).toBe(outside)
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("uses an explicit file kind without treating an existing directory as the target boundary", () =>
    withTmp((directory) =>
      withTmp((outside) =>
        Effect.gen(function* () {
          const target = yield* (yield* LocationMutation.Service).resolve({ path: outside, kind: "file" })
          expect(target.externalDirectory).toMatchObject({
            directory: path.dirname(outside),
            resource: path.join(path.dirname(outside), "*").replaceAll("\\", "/"),
          })
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("authorizes prospective external descendants at their lexical parent", () =>
    withTmp((directory) =>
      withTmp((outside) =>
        Effect.gen(function* () {
          const targetPath = path.join(outside, "new", "nested", "file.txt")
          const target = yield* (yield* LocationMutation.Service).resolve({ path: targetPath })
          const parent = path.dirname(targetPath)
          expect(target.externalDirectory).toMatchObject({
            directory: parent,
            resource: path.join(parent, "*").replaceAll("\\", "/"),
          })
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("classifies an external target against the location environment, not the server host", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const memory = Environment.makeMemoryDriver()
      const files = Environment.makeFiles(memory)
      yield* files.mkdir("/workspace/project")
      yield* files.mkdir("/remote/data")
      yield* memory.symlink("/remote/data", "/remote/link")
      yield* Effect.gen(function* () {
        const mutation = yield* LocationMutation.Service
        // The directory exists only in the location environment; the server host has no /remote.
        expect((yield* mutation.resolve({ path: "/remote/data" })).externalDirectory).toMatchObject({
          directory: "/remote/data",
          resource: "/remote/data/*",
        })
        // A final symlink is followed when classifying the boundary.
        expect((yield* mutation.resolve({ path: "/remote/link" })).externalDirectory).toMatchObject({
          directory: "/remote/link",
          resource: "/remote/link/*",
        })
      }).pipe(provideMemory("/workspace/project", memory))
    }),
  )

  it.live("derives the external save boundary from the location environment project root", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const memory = Environment.makeMemoryDriver()
      const files = Environment.makeFiles(memory)
      yield* files.mkdir("/workspace/project")
      yield* files.mkdir("/remote/repo/.git")
      yield* Effect.gen(function* () {
        const target = yield* (yield* LocationMutation.Service).resolve({ path: "/remote/repo/nested/file.txt" })
        expect(target.externalDirectory).toMatchObject({
          directory: "/remote/repo/nested",
          resource: "/remote/repo/nested/*",
          save: "/remote/repo/*",
        })
      }).pipe(provideMemory("/workspace/project", memory))
    }),
  )

  test("ignores unknown mutation input fields", () => {
    expect(Object.keys(LocationMutation.ResolveInput.fields)).toEqual(["path", "kind"])
    expect(Schema.decodeUnknownSync(LocationMutation.ResolveInput)({ path: "README.md", reference: "docs" })).toEqual({
      path: "README.md",
    })
  })
})
