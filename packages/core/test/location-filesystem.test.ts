import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Search } from "@opencode-ai/core/filesystem/search"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

function provide(directory: string, search = Search.defaultLayer) {
  return Effect.provide(
    FileSystem.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          FSUtil.defaultLayer,
          search,
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

describe("FileSystem", () => {
  it.live("reads complete text and binary files", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const text = Array.from({ length: 3_000 }, (_, index) => `line-${index + 1}`).join("\n")
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "large.txt"), text))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "data.bin"), Buffer.from([0, 1, 2])))
        const service = yield* FileSystem.Service
        const textContent = yield* service.read({ path: RelativePath.make("large.txt") })
        expect(textContent).toEqual({
          uri: textContent.uri,
          name: "large.txt",
          content: text,
          encoding: "utf8",
          mime: "text/plain",
        })
        expect(fileURLToPath(textContent.uri)).toBe(path.join(directory, "large.txt"))
        const binaryContent = yield* service.read({ path: RelativePath.make("data.bin") })
        expect(binaryContent).toEqual({
          uri: binaryContent.uri,
          name: "data.bin",
          content: "AAEC",
          encoding: "base64",
          mime: "application/octet-stream",
        })
        expect(fileURLToPath(binaryContent.uri)).toBe(path.join(directory, "data.bin"))
      }).pipe(provide(directory)),
    ),
  )

  it.live("lists direct children with relative paths and resolved URIs", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "README.md"), "# Test"))
        const entries = yield* (yield* FileSystem.Service).list()
        expect(entries.map(({ uri: _uri, ...entry }) => entry)).toEqual([
          { path: RelativePath.make("src"), type: "directory", mime: "application/x-directory" },
          { path: RelativePath.make("README.md"), type: "file", mime: "text/markdown" },
        ])
        expect(
          yield* Effect.promise(() => Promise.all(entries.map((entry) => fs.realpath(fileURLToPath(entry.uri))))),
        ).toEqual(
          yield* Effect.promise(() =>
            Promise.all([fs.realpath(path.join(directory, "src")), fs.realpath(path.join(directory, "README.md"))]),
          ),
        )
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects lexical and symlink escapes", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const service = yield* FileSystem.Service
        expect(
          Exit.isFailure(yield* service.read({ path: RelativePath.make("../outside.txt") }).pipe(Effect.exit)),
        ).toBe(true)
        if (process.platform === "win32") return
        const outside = `${directory}-outside.txt`
        yield* Effect.promise(() => fs.writeFile(outside, "outside"))
        yield* Effect.promise(() => fs.symlink(outside, path.join(directory, "link.txt")))
        expect(Exit.isFailure(yield* service.read({ path: RelativePath.make("link.txt") }).pipe(Effect.exit))).toBe(
          true,
        )
        yield* Effect.promise(() => fs.rm(outside, { force: true }))
      }).pipe(provide(directory)),
    ),
  )

  it.live("finds and greps files", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "src", "index.ts"), "const needle = true\n"))
        const service = yield* FileSystem.Service
        expect((yield* service.find({ query: "index", type: "file" })).map((item) => item.path)).toEqual([
          RelativePath.make(path.join("src", "index.ts")),
        ])
        expect(yield* service.grep({ pattern: "needle" })).toMatchObject([
          { path: RelativePath.make(path.join("src", "index.ts")), line: 1, offset: 0 },
        ])
      }).pipe(
        provide(
          directory,
          Layer.effect(
            Search.Service,
            Effect.gen(function* () {
              const search = yield* Search.Service
              return Search.Service.of({
                ...search,
                file: () => Effect.succeed([{ path: path.join("src", "index.ts"), type: "file" }]),
              })
            }),
          ).pipe(Layer.provide(Search.defaultLayer)),
        ),
      ),
    ),
  )

  it.live("uses the type supplied by Search file results", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "selected.ts"), "export {}\n"))
        expect((yield* (yield* FileSystem.Service).find({ query: "ignored", limit: 1 }))[0]).toMatchObject({
          path: RelativePath.make("selected.ts"),
          type: "directory",
          mime: "application/x-directory",
        })
      }).pipe(
        provide(
          directory,
          Layer.effect(
            Search.Service,
            Effect.gen(function* () {
              const search = yield* Search.Service
              return Search.Service.of({
                ...search,
                file: () => Effect.succeed([{ path: "selected.ts", type: "directory" }]),
              })
            }),
          ).pipe(Layer.provide(Search.defaultLayer)),
        ),
      ),
    ),
  )
})
