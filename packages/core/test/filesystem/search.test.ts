import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { FileSystemSearch } from "@opencode-ai/core/filesystem/search"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "@opencode-ai/core/location"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Ripgrep.node))
const searchIt = testEffect(Layer.empty)

const withTmp = <A, E, R>(f: (directory: AbsolutePath) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(AbsolutePath.make(tmp.path))))

describe("Ripgrep", () => {
  it.live("globs files as an array", () =>
    withTmp((cwd) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(cwd, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(cwd, "src", "match.ts"), "needle\n"))
        const result = yield* (yield* Ripgrep.Service).glob({ cwd, pattern: "**/*.ts", limit: 10 })
        expect(result.map((item) => item.path)).toEqual([RelativePath.make("src/match.ts")])
      }),
    ),
  )

  it.live("greps files with include filtering", () =>
    withTmp((cwd) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(cwd, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(cwd, "src", "match.ts"), "needle\n"))
        yield* Effect.promise(() => fs.writeFile(path.join(cwd, "src", "skip.txt"), "needle\n"))
        const result = yield* (yield* Ripgrep.Service).grep({ cwd, pattern: "needle", include: "*.ts", limit: 10 })
        expect(result).toHaveLength(1)
        expect(result[0]?.entry.path).toBe(RelativePath.make("src/match.ts"))
        expect(result[0]?.submatches[0]?.text).toBe("needle")
      }),
    ),
  )
})

describe("FileSystemSearch", () => {
  searchIt.live("finds partial file and directory results while indexing", () =>
    Effect.gen(function* () {
      const firstIndexed = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const secondIndexed = yield* Deferred.make<void>()
      const first = FileSystem.Entry.make({ path: RelativePath.make("src/first.ts"), type: "file" })
      const second = FileSystem.Entry.make({ path: RelativePath.make("test/nested/second.ts"), type: "file" })
      const ripgrep = Layer.succeed(
        Ripgrep.Service,
        Ripgrep.Service.of({
          find: (input) =>
            Effect.gen(function* () {
              if (input.onEntry) yield* input.onEntry(first)
              yield* Deferred.succeed(firstIndexed, undefined)
              yield* Deferred.await(release)
              if (input.onEntry) yield* input.onEntry(second)
              yield* Deferred.succeed(secondIndexed, undefined)
              return [first, second]
            }),
          glob: () => Effect.die("unused"),
          grep: () => Effect.die("unused"),
        }),
      )
      const layer = FileSystemSearch.ripgrepLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            LayerNode.compile(FSUtil.node),
            Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/repo") }))),
            ripgrep,
          ),
        ),
      )

      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        yield* Deferred.await(firstIndexed)

        expect(yield* search.find({ query: "first", type: "file" })).toEqual([first])
        expect(yield* search.find({ query: "src", type: "directory" })).toEqual([
          FileSystem.Entry.make({ path: RelativePath.make(`src${path.sep}`), type: "directory" }),
        ])
        expect(yield* search.find({ query: "src" })).toEqual([
          FileSystem.Entry.make({ path: RelativePath.make(`src${path.sep}`), type: "directory" }),
          first,
        ])

        yield* Deferred.succeed(release, undefined)
        yield* Deferred.await(secondIndexed)

        expect(yield* search.find({ query: "nested", type: "directory" })).toEqual([
          FileSystem.Entry.make({
            path: RelativePath.make(`test${path.sep}nested${path.sep}`),
            type: "directory",
          }),
        ])
      }).pipe(Effect.provide(layer))
    }),
  )
})
