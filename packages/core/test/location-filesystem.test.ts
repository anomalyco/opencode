import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Environment } from "@opencode-ai/core/environment/index"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Workspace } from "@opencode-ai/core/workspace"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const provide = (directory: string, workspaceID?: Workspace.ID) =>
  Effect.provide(
    LayerNode.compile(FileSystem.node, {
      replacements: [
        Location.node.replace(
          Layer.succeed(
            Location.Service,
            Location.Service.of(location({ directory: AbsolutePath.make(directory), workspaceID })),
          ),
        ),
      ],
    }),
  )

const provideMemory = (directory: string, memory: Environment.MemoryDriver) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(
      location({ directory: AbsolutePath.make(directory), workspaceID: Workspace.ID.make("wrk_filesystem") }),
    ),
  )
  return Effect.provide(
    LayerNode.compile(FileSystem.node, [
      [Location.node, activeLocation],
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

const withTmp = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))

describe("FileSystem", () => {
  it.live("reads text and binary files", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "text.txt"), "hello"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "data.bin"), Buffer.from([0, 1, 2])))
        const service = yield* FileSystem.Service
        const text = yield* service.read({ path: RelativePath.make("text.txt") })
        const binary = yield* service.read({ path: RelativePath.make("data.bin") })
        expect(new TextDecoder().decode(text.content)).toBe("hello")
        expect(text.mime).toBe("text/plain")
        expect(binary.content).toEqual(new Uint8Array([0, 1, 2]))
      }).pipe(provide(directory)),
    ),
  )

  it.live("lists direct children", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "README.md"), "# Test"))
        const filesystem = yield* FileSystem.Service
        const entries = yield* filesystem.list()
        expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("src" + path.sep), type: "directory" },
          { path: RelativePath.make("README.md"), type: "file" },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("uses the workspace environment when the directory is absent on the host", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        if (process.platform === "win32") return
        const missing = path.join(directory, "workspace-only")
        const memory = Environment.makeMemoryDriver()
        const files = Environment.makeFiles(memory)
        yield* files.write(path.join(missing, "remote.txt"), new TextEncoder().encode("remote"))

        const workspace = yield* Effect.gen(function* () {
          const service = yield* FileSystem.Service
          return yield* service.read({ path: RelativePath.make("remote.txt") })
        }).pipe(provideMemory(missing, memory), Effect.exit)
        expect(Exit.isSuccess(workspace)).toBe(true)
        if (Exit.isSuccess(workspace)) expect(new TextDecoder().decode(workspace.value.content)).toBe("remote")

        // A local ref with the same missing directory still fails boot because
        // host realpath canonicalization remains load-bearing locally.
        const local = yield* FileSystem.Service.pipe(provide(missing), Effect.exit)
        expect(Exit.isFailure(local)).toBe(true)
      }),
    ),
  )

  it.live("reads and lists the workspace environment instead of a same-named host directory", () =>
    withTmp((directory) => {
      const memory = Environment.makeMemoryDriver()
      return Effect.gen(function* () {
        if (process.platform === "win32") return
        const files = Environment.makeFiles(memory)
        yield* files.mkdir(directory)
        yield* files.write(path.join(directory, "shared.txt"), new TextEncoder().encode("workspace"))
        yield* files.write(path.join(directory, "workspace-only.txt"), new TextEncoder().encode("remote"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "shared.txt"), "host"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "host-only.txt"), "local"))

        const service = yield* FileSystem.Service
        const read = yield* service.read({ path: RelativePath.make("shared.txt") })
        const entries = yield* service.list()

        expect(new TextDecoder().decode(read.content)).toBe("workspace")
        expect(entries.map((entry) => entry.path)).toEqual([
          RelativePath.make("shared.txt"),
          RelativePath.make("workspace-only.txt"),
        ])
      }).pipe(provideMemory(directory, memory))
    }),
  )

  it.live("canonicalizes workspace paths before enforcing the location boundary", () => {
    const memory = Environment.makeMemoryDriver()
    return Effect.gen(function* () {
      if (process.platform === "win32") return
      const files = Environment.makeFiles(memory)
      yield* files.mkdir("/workspace/project")
      yield* files.write("/workspace/project/inside.txt", new TextEncoder().encode("inside"))
      yield* files.write("/outside.txt", new TextEncoder().encode("outside"))
      yield* memory.symlink("inside.txt", "/workspace/project/inside-link")
      yield* memory.symlink("/outside.txt", "/workspace/project/outside-link")

      const service = yield* FileSystem.Service
      const internal = yield* service.read({ path: RelativePath.make("inside-link") })
      const escaped = yield* service.read({ path: RelativePath.make("outside-link") }).pipe(Effect.exit)

      expect(new TextDecoder().decode(internal.content)).toBe("inside")
      expect(Exit.isFailure(escaped)).toBe(true)
    }).pipe(provideMemory("/workspace/project", memory))
  })

  it.live("canonicalizes local symlinked directories", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const real = path.join(directory, "real")
        yield* Effect.promise(() => fs.mkdir(real))
        yield* Effect.promise(() => fs.writeFile(path.join(real, "file.txt"), "linked"))
        const link = path.join(directory, "link")
        yield* Effect.promise(() => fs.symlink(real, link))
        // Reads resolve through the symlink only because boot canonicalized
        // the location root to the real directory.
        const read = yield* FileSystem.Service.pipe(
          Effect.flatMap((service) => service.read({ path: RelativePath.make("file.txt") })),
          provide(link),
        )
        expect(new TextDecoder().decode(read.content)).toBe("linked")
      }),
    ),
  )

  it.live("rejects lexical escapes", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const filesystem = yield* FileSystem.Service
        const result = yield* filesystem.read({ path: RelativePath.make("../outside.txt") }).pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
      }).pipe(provide(directory)),
    ),
  )
})
