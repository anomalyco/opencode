import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
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

  it.live("writes exact bytes including UTF-8, CRLF, BOM, binary, and empty content", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const filesystem = yield* FileSystem.Service
        yield* Effect.forEach(
          [
            ...["caf\u00e9\n", "first\r\nsecond\r\n", "\ufeffBOM\r\n", ""].map((text) =>
              new TextEncoder().encode(text),
            ),
            new Uint8Array([0, 128, 255]),
          ],
          (content) =>
            Effect.gen(function* () {
              const expected = new TextEncoder().encode("original content is longer\r\n")
              yield* Effect.promise(() => fs.writeFile(path.join(directory, "file.txt"), expected))
              expect(yield* filesystem.write({ path: RelativePath.make("file.txt"), content, expected })).toBe(true)
              expect((yield* filesystem.read({ path: RelativePath.make("file.txt") })).content).toEqual(content)
            }),
        )
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects changed bytes without modifying the file", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const filesystem = yield* FileSystem.Service
        const current = new TextEncoder().encode("new\r\n")
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "file.txt"), current))
        yield* Effect.forEach(["old\r\n", "new\n", "\ufeffnew\r\n", ""], (text) =>
          Effect.gen(function* () {
            const result = yield* filesystem
              .write({
                path: RelativePath.make("file.txt"),
                content: new TextEncoder().encode("replacement"),
                expected: new TextEncoder().encode(text),
              })
              .pipe(Effect.flip)
            expect(result).toBeInstanceOf(FileSystem.WriteConflictError)
            expect(result.path).toBe(RelativePath.make("file.txt"))
            expect(result.message).toBe("File changed since it was read")
            expect((yield* filesystem.read({ path: RelativePath.make("file.txt") })).content).toEqual(current)
          }),
        )
      }).pipe(provide(directory)),
    ),
  )

  it.live("allows only one concurrent save against the same baseline", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const filesystem = yield* FileSystem.Service
        const expected = new TextEncoder().encode("before")
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "file.txt"), expected))
        const results = yield* Effect.forEach(
          Array.from({ length: 8 }, (_, index) => index),
          (index) =>
            filesystem
              .write({
                path: RelativePath.make("file.txt"),
                expected,
                content: new TextEncoder().encode(`writer ${index}`),
              })
              .pipe(Effect.exit),
          { concurrency: "unbounded" },
        )
        expect(results.filter(Exit.isSuccess)).toHaveLength(1)
        expect(results.filter(Exit.isFailure)).toHaveLength(7)
        expect(yield* Effect.promise(() => Bun.file(path.join(directory, "file.txt")).text())).toBe(
          `writer ${results.findIndex(Exit.isSuccess)}`,
        )
      }).pipe(provide(directory)),
    ),
  )

  it.live("writes only existing regular files within lexical and real path boundaries", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const root = path.join(directory, "root")
        const outside = path.join(directory, "outside")
        yield* Effect.promise(async () => {
          await fs.mkdir(root)
          await fs.mkdir(outside)
          await fs.mkdir(path.join(root, "inside"))
          await fs.writeFile(path.join(outside, "file.txt"), "before")
          await fs.writeFile(path.join(root, "inside", "file.txt"), "before")
          await fs.symlink(outside, path.join(root, "escape"), "junction")
          await fs.symlink(path.join(root, "inside"), path.join(root, "link"), "junction")
        })
        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          const expected = new TextEncoder().encode("before")
          const content = new TextEncoder().encode("after")
          yield* Effect.forEach(["missing.txt", "inside", "../outside/file.txt", "escape/file.txt"], (file) =>
            Effect.gen(function* () {
              const result = yield* filesystem
                .write({ path: RelativePath.make(file), content, expected })
                .pipe(Effect.exit)
              expect(Exit.isFailure(result)).toBe(true)
            }),
          )
          expect(yield* Effect.promise(() => Bun.file(path.join(root, "missing.txt")).exists())).toBe(false)
          expect(yield* Effect.promise(() => Bun.file(path.join(outside, "file.txt")).text())).toBe("before")
          expect(yield* filesystem.write({ path: RelativePath.make("link/file.txt"), content, expected })).toBe(true)
          expect((yield* filesystem.read({ path: RelativePath.make("inside/file.txt") })).content).toEqual(content)
        }).pipe(provide(root))
      }),
    ),
  )

  it.live("does not write a host file for a workspace location", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "file.txt"), "before"))
        const filesystem = yield* FileSystem.Service
        const result = yield* filesystem
          .write({
            path: RelativePath.make("file.txt"),
            expected: new TextEncoder().encode("before"),
            content: new TextEncoder().encode("after"),
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
        expect(yield* Effect.promise(() => Bun.file(path.join(directory, "file.txt")).text())).toBe("before")
      }).pipe(provide(directory, Workspace.ID.make("wrk_filesystem"))),
    ),
  )

  it.live("skips host canonicalization for workspace locations at boot", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        // The directory exists only inside the workspace, so boot must not
        // require it to exist on the host. Operations still access the host
        // filesystem per call (#44568); only boot canonicalization is skipped.
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
