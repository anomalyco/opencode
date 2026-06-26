import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Flag } from "@opencode-ai/core/flag/flag"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const provideLayer = (directory: string, ripgrep: Layer.Layer<Ripgrep.Service>) =>
  FileSystem.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        FSUtil.defaultLayer,
        ripgrep,
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
      ),
    ),
  )

const provide = (directory: string) => Effect.provide(provideLayer(directory, Ripgrep.defaultLayer))

const provideWithRipgrep = (directory: string, ripgrep: Ripgrep.Interface) =>
  Effect.provide(provideLayer(directory, Layer.succeed(Ripgrep.Service, Ripgrep.Service.of(ripgrep))))

const withTmp = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))

const withRipgrepSearch = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = Flag.OPENCODE_DISABLE_FFF
      Flag.OPENCODE_DISABLE_FFF = true
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        Flag.OPENCODE_DISABLE_FFF = previous
      }),
  ).pipe(Effect.flatMap(() => effect))

const trackRipgrep = (entries: readonly FileSystem.Entry[] = []) => {
  let findCalls = 0
  return {
    calls: () => findCalls,
    ripgrep: {
      find: (input) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            findCalls += 1
          })
          yield* Effect.yieldNow
          yield* Effect.forEach(entries, (entry) => input.onEntry?.(entry) ?? Effect.void, { discard: true })
          return entries
        }),
      glob: () => Effect.succeed([]),
      grep: () => Effect.succeed([]),
    } satisfies Ripgrep.Interface,
  }
}

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
        const service = yield* FileSystem.Service
        const entries = yield* service.list()
        expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("src" + path.sep), type: "directory" },
          { path: RelativePath.make("README.md"), type: "file" },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("finds direct children for empty queries", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src", "nested")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "src", "nested", "deep.txt"), "deep"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "README.md"), "# Test"))

        const service = yield* FileSystem.Service
        const entries = yield* service.find({ query: "" })

        expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("src" + path.sep), type: "directory" },
          { path: RelativePath.make("README.md"), type: "file" },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("filters and limits empty query find results", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "alpha")))
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "beta")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "a.txt"), "a"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "b.txt"), "b"))

        const service = yield* FileSystem.Service
        const directories = yield* service.find({ query: "   ", type: "directory", limit: 1 })
        const files = yield* service.find({ query: "", type: "file", limit: 1 })

        expect(directories.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("alpha" + path.sep), type: "directory" },
        ])
        expect(files.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("a.txt"), type: "file" },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("prioritizes visible direct children before hidden entries for empty query limits", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.forEach(
          [".config", ".cache", ".local", "alpha", "beta"],
          (name) => Effect.promise(() => fs.mkdir(path.join(directory, name))),
          { discard: true },
        )

        const service = yield* FileSystem.Service
        const entries = yield* service.find({ query: "", type: "directory", limit: 2 })

        expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("alpha" + path.sep), type: "directory" },
          { path: RelativePath.make("beta" + path.sep), type: "directory" },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("does not start recursive search for empty queries", () =>
    withTmp((directory) => {
      const ripgrep = trackRipgrep()
      return withRipgrepSearch(
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
          yield* Effect.promise(() => fs.writeFile(path.join(directory, "README.md"), "# Test"))

          const service = yield* FileSystem.Service
          const entries = yield* service.find({ query: "" })
          yield* Effect.yieldNow

          expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make("src" + path.sep), type: "directory" },
            { path: RelativePath.make("README.md"), type: "file" },
          ])
          expect(ripgrep.calls()).toBe(0)
        }).pipe(provideWithRipgrep(directory, ripgrep.ripgrep)),
      )
    }),
  )

  it.live("keeps non-empty find deterministic after an empty query", () =>
    withTmp((directory) => {
      const target = FileSystem.Entry.make({ path: RelativePath.make("src/target.ts"), type: "file" })
      const ripgrep = trackRipgrep([
        target,
        FileSystem.Entry.make({ path: RelativePath.make("src/other.ts"), type: "file" }),
      ])
      return withRipgrepSearch(
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
          yield* Effect.promise(() => fs.writeFile(path.join(directory, "src", "target.ts"), "target"))
          yield* Effect.promise(() => fs.writeFile(path.join(directory, "src", "other.ts"), "other"))
          yield* Effect.promise(() => fs.writeFile(path.join(directory, "README.md"), "# Test"))

          const service = yield* FileSystem.Service
          const empty = yield* service.find({ query: "" })
          const found = yield* service.find({ query: "target" })

          expect(empty.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: RelativePath.make("src" + path.sep), type: "directory" },
            { path: RelativePath.make("README.md"), type: "file" },
          ])
          expect(found.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
            { path: target.path, type: "file" },
          ])
          expect(ripgrep.calls()).toBe(1)
        }).pipe(provideWithRipgrep(directory, ripgrep.ripgrep)),
      )
    }),
  )

  it.live("runs non-empty glob and grep through lazy search", () =>
    withTmp((directory) =>
      withRipgrepSearch(
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
          yield* Effect.promise(() => fs.writeFile(path.join(directory, "src", "match.ts"), "needle\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(directory, "src", "skip.txt"), "needle\n"))

          const service = yield* FileSystem.Service
          const glob = yield* service.glob({ pattern: "**/*.ts" })
          const grep = yield* service.grep({ pattern: "needle", include: "*.ts" })

          expect(glob.map((entry) => entry.path)).toEqual([RelativePath.make("src/match.ts")])
          expect(grep).toHaveLength(1)
          expect(grep[0]?.entry.path).toBe(RelativePath.make("src/match.ts"))
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("rejects lexical escapes", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const service = yield* FileSystem.Service
        const result = yield* service.read({ path: RelativePath.make("../outside.txt") }).pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
      }).pipe(provide(directory)),
    ),
  )
})
