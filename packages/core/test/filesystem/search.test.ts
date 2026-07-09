import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Entry } from "@opencode-ai/core/filesystem"
import { FileSystemSearch } from "@opencode-ai/core/filesystem/search"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Ripgrep.node))

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
  it.live("indexes unique parent directories from ripgrep entries", () =>
    Effect.gen(function* () {
      const indexed = yield* Deferred.make<"indexed">()
      const entries = [
        Entry.make({ path: RelativePath.make("src/index.ts"), type: "file" }),
        Entry.make({ path: RelativePath.make("src/components/button.ts"), type: "file" }),
        Entry.make({ path: RelativePath.make("src/components/card.ts"), type: "file" }),
      ]
      const fakeRipgrep = Layer.succeed(
        Ripgrep.Service,
        Ripgrep.Service.of({
          find: (input) =>
            Effect.gen(function* () {
              yield* Effect.forEach(entries, (entry) => input.onEntry?.(entry) ?? Effect.void)
              yield* Deferred.succeed(indexed, "indexed")
              return entries
            }),
          glob: () => Effect.succeed([]),
          grep: () => Effect.succeed([]),
        }),
      )
      const activeLocation = Layer.succeed(
        Location.Service,
        Location.Service.of(location({ directory: AbsolutePath.make("/workspace") })),
      )
      const searchLayer = FileSystemSearch.ripgrepLayer.pipe(
        Layer.provide(Layer.mergeAll(LayerNode.compile(FSUtil.node), activeLocation, fakeRipgrep)),
      )

      yield* Effect.gen(function* () {
        const service = yield* FileSystemSearch.Service
        expect(yield* Deferred.await(indexed).pipe(Effect.timeout("1 second"))).toBe("indexed")
        const result = yield* service.find({ query: "src", type: "directory", limit: 10 })
        expect(result.map((item) => item.path).sort()).toEqual(
          [RelativePath.make("src" + path.sep), RelativePath.make("src/components" + path.sep)].sort(),
        )
      }).pipe(Effect.provide(searchLayer))
    }),
  )
})
