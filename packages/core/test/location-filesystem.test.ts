import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Option, PlatformError, Stream } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Environment, makeMemoryDriver } from "@opencode/core/environment/index"
import { FileSystem } from "@opencode/core/filesystem"
import { Location } from "@opencode/core/location"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { Workspace } from "@opencode/core/workspace"
import { location } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
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

const withTmp = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  tmpdirScoped().pipe(Effect.flatMap((tmp) => f(tmp.path)))

describe("FileSystem", () => {
  it.live("reads text and binary files", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "text.txt"), "hello"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "data.bin"), Buffer.from([0, 1, 2, 3, 4])))
        const service = yield* FileSystem.Service
        const text = yield* service.read({ path: RelativePath.make("text.txt") })
        const binary = yield* service.read({ path: RelativePath.make("data.bin") })
        expect(new TextDecoder().decode(yield* Stream.mkUint8Array(text.stream()))).toBe("hello")
        expect(text.mime).toBe("text/plain")
        expect(text.size).toBe(5)
        expect(Option.isSome(text.mtime)).toBe(true)
        expect(yield* Stream.mkUint8Array(binary.stream())).toEqual(new Uint8Array([0, 1, 2, 3, 4]))
        expect(yield* Stream.mkUint8Array(binary.stream({ offset: 1, bytesToRead: 3 }))).toEqual(
          new Uint8Array([1, 2, 3]),
        )
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

  it.live("skips host canonicalization for workspace locations at boot", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        // The directory exists only inside the workspace, so boot must not
        // require it to exist on the host.
        const missing = path.join(directory, "workspace-only")
        const workspace = yield* FileSystem.Service.pipe(
          provide(missing, Workspace.ID.make("wrk_filesystem")),
          Effect.exit,
        )
        expect(Exit.isSuccess(workspace)).toBe(true)

        // A local ref with the same missing directory keeps failing boot:
        // host realpath canonicalization stays load-bearing for local placements.
        const local = yield* FileSystem.Service.pipe(provide(missing), Effect.exit)
        expect(Exit.isFailure(local)).toBe(true)
        if (Exit.isFailure(local)) {
          const error = Cause.findErrorOption(local.cause)
          expect(error).toMatchObject({
            _tag: "Some",
            value: {
              _tag: "FileSystem.DirectoryNotFoundError",
              directory: missing,
              message: `Directory not found: ${missing}`,
            },
          })
        }
      }),
    ),
  )

  for (const input of [
    { reason: "PermissionDenied", code: "EACCES", denied: true },
    { reason: "Unknown", code: "EPERM", denied: true },
    { reason: "Unknown", code: "EIO", denied: false },
  ] as const) {
    it.live(`classifies directory initialization failure ${input.code}`, () =>
      withTmp((directory) =>
        Effect.gen(function* () {
          const filesystem = yield* FSUtil.Service
          const cause = PlatformError.systemError({
            _tag: input.reason,
            module: "FileSystem",
            method: "realPath",
            pathOrDescriptor: directory,
            cause: Object.assign(new Error(input.code), { code: input.code }),
          })
          const result = yield* FileSystem.Service.pipe(
            Effect.provide(
              LayerNode.compile(FileSystem.node, {
                replacements: [
                  Location.node.replace(
                    Layer.succeed(Location.Service, location({ directory: AbsolutePath.make(directory) })),
                  ),
                  FSUtil.node.replace(
                    Layer.succeed(FSUtil.Service, {
                      ...filesystem,
                      realPath: (target) => (target === directory ? Effect.fail(cause) : filesystem.realPath(target)),
                    }),
                  ),
                ],
              }),
            ),
            Effect.exit,
          )
          expect(Exit.isFailure(result)).toBe(true)
          if (Exit.isFailure(result)) {
            if (input.denied) {
              expect(Cause.findErrorOption(result.cause)).toMatchObject({
                _tag: "Some",
                value: {
                  _tag: "FileSystem.DirectoryAccessDeniedError",
                  directory,
                  cause,
                  message: `Access denied to directory: ${directory}`,
                },
              })
              return
            }
            expect(result.cause.reasons.filter(Cause.isDieReason)).toMatchObject([{ defect: cause }])
          }
        }).pipe(Effect.provide(LayerNode.compile(FSUtil.node))),
      ),
    )
  }

  it.live("lists parents and siblings with paths relative to the current location", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const current = path.join(directory, "current")
        yield* Effect.promise(() => fs.mkdir(current))
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "sibling")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "sibling", "file.txt"), "outside"))
        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          const parent = yield* filesystem.list({ path: RelativePath.make("..") })
          expect(parent).toHaveLength(2)
          expect(parent.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual(
            expect.arrayContaining([
              { path: "." + path.sep, type: "directory" },
              { path: path.join("..", "sibling") + path.sep, type: "directory" },
            ]),
          )
          const sibling = yield* filesystem.list({ path: RelativePath.make("../sibling") })
          expect(sibling.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make(path.join("..", "sibling", "file.txt")), type: "file" },
          ])
          const absolute = yield* filesystem.list({ path: path.join(directory, "sibling") })
          expect(absolute).toEqual(sibling)
          const missing = yield* Effect.flip(filesystem.list({ path: RelativePath.make("missing") }))
          expect(missing).toBeInstanceOf(FileSystem.NotFoundError)
          const file = yield* Effect.flip(filesystem.list({ path: RelativePath.make("../sibling/file.txt") }))
          expect(file).toBeInstanceOf(FileSystem.NotFoundError)
        }).pipe(provide(current))
      }),
    ),
  )

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
          Effect.flatMap((file) => Stream.mkUint8Array(file.stream())),
          provide(link),
        )
        expect(new TextDecoder().decode(read)).toBe("linked")
      }),
    ),
  )

  it.live("rejects lexical escapes", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const current = path.join(directory, "current")
        yield* Effect.promise(() => fs.mkdir(current))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "outside.txt"), "outside"))
        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          const result = yield* filesystem.read({ path: RelativePath.make("../outside.txt") }).pipe(Effect.exit)
          expect(Exit.isFailure(result)).toBe(true)
        }).pipe(provide(current))
      }),
    ),
  )

  it.live("allows listing through an external symlink without allowing file reads", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const current = path.join(directory, "current")
        const outside = path.join(directory, "outside")
        yield* Effect.promise(() => fs.mkdir(current))
        yield* Effect.promise(() => fs.mkdir(outside))
        yield* Effect.promise(() => fs.writeFile(path.join(outside, "file.txt"), "outside"))
        yield* Effect.promise(() => fs.symlink(outside, path.join(current, "link"), "junction"))
        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          const entries = yield* filesystem.list({ path: RelativePath.make("link") })
          expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make(path.join("link", "file.txt")), type: "file" },
          ])
          const result = yield* filesystem.read({ path: RelativePath.make("link/file.txt") }).pipe(Effect.exit)
          expect(Exit.isFailure(result)).toBe(true)
        }).pipe(provide(current))
      }),
    ),
  )

  it.effect(
    "reads, paginates chunks, lists, writes, and enforces lexical confinement over remote Environment.files",
    () =>
      Effect.gen(function* () {
        const memory = makeMemoryDriver()
        const env = Environment.workspace(Workspace.ID.make("wrk_remote_fs"), memory)
        yield* env.files.write("/workspace/src/hello.txt", new TextEncoder().encode("hello remote"))
        yield* env.files.write("/outside.txt", new TextEncoder().encode("secret"))
        yield* memory.symlink("../outside.txt", "/workspace/link.txt")
        // 5 MiB payload exercises multi-chunk pagination (> 4 MiB REMOTE_CHUNK_BYTES).
        const big = new Uint8Array(5 * 1024 * 1024)
        big.fill(42)
        big[0] = 7
        big[big.length - 1] = 99
        yield* env.files.write("/workspace/big.bin", big)

        const layer = LayerNode.compile(FileSystem.node, {
          replacements: [
            Location.node.replace(
              Layer.succeed(
                Location.Service,
                Location.Service.of(
                  location({
                    directory: AbsolutePath.make("/workspace"),
                    workspaceID: Workspace.ID.make("wrk_remote_fs"),
                  }),
                ),
              ),
            ),
            Environment.node.replace(Layer.succeed(Environment.Service, env)),
          ],
        })

        yield* Effect.gen(function* () {
          const service = yield* FileSystem.Service

          // Read whole file, ranged slice, offset-to-EOF, zero-byte read, and past-EOF read
          const file = yield* service.read({ path: RelativePath.make("src/hello.txt") })
          expect(file.mime).toBe("text/plain")
          expect(file.size).toBe(12)
          expect(Option.isSome(file.mtime)).toBe(true)
          expect(new TextDecoder().decode(yield* Stream.mkUint8Array(file.stream()))).toBe("hello remote")
          expect(new TextDecoder().decode(yield* Stream.mkUint8Array(file.stream({ offset: 6, bytesToRead: 6 })))).toBe(
            "remote",
          )
          expect(new TextDecoder().decode(yield* Stream.mkUint8Array(file.stream({ offset: 6 })))).toBe("remote")
          expect(yield* Stream.mkUint8Array(file.stream({ bytesToRead: 0 }))).toEqual(new Uint8Array(0))
          expect(yield* Stream.mkUint8Array(file.stream({ offset: 99 }))).toEqual(new Uint8Array(0))

          // Multi-chunk pagination streams >4 MiB files intact without hitting a single-read cap
          const bigFile = yield* service.read({ path: RelativePath.make("big.bin") })
          const bigBytes = yield* Stream.mkUint8Array(bigFile.stream())
          expect(bigBytes.length).toBe(big.length)
          expect([bigBytes[0], bigBytes[bigBytes.length - 1]]).toEqual([7, 99])

          // Remote reads enforce lexical confinement (symlinks follow inside the sandbox boundary)
          const linked = yield* service.read({ path: RelativePath.make("link.txt") })
          expect(new TextDecoder().decode(yield* Stream.mkUint8Array(linked.stream()))).toBe("secret")

          // Lexical escape, NUL byte, missing file, and reading a directory all fail with NotFoundError
          for (const bad of ["../outside.txt", "src/\u0000.txt", "missing.txt", "src"]) {
            expect(yield* Effect.flip(service.read({ path: RelativePath.make(bad) }))).toBeInstanceOf(
              FileSystem.NotFoundError,
            )
          }

          // Write creates parent directories and reads back via POSIX paths
          const written = yield* service.write({ path: "notes/out.md", data: new TextEncoder().encode("# Hi") })
          expect(written.path).toBe(AbsolutePath.make("/workspace/notes/out.md"))
          const readBack = yield* service.read({ path: RelativePath.make("notes/out.md") })
          expect(new TextDecoder().decode(yield* Stream.mkUint8Array(readBack.stream()))).toBe("# Hi")

          // List uses POSIX separators on remote workspaces regardless of host OS, including parent navigation
          const entries = yield* service.list()
          expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make("notes/"), type: "directory" },
            { path: RelativePath.make("src/"), type: "directory" },
            { path: RelativePath.make("big.bin"), type: "file" },
          ])
          const parentEntries = yield* service.list({ path: ".." })
          expect(parentEntries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make("./"), type: "directory" },
            { path: RelativePath.make("../outside.txt"), type: "file" },
          ])
          expect(yield* Effect.flip(service.list({ path: "src/hello.txt" }))).toBeInstanceOf(FileSystem.NotFoundError)
        }).pipe(Effect.provide(layer))
      }),
  )
})
