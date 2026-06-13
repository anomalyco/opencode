import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { FileSystemSearch } from "@opencode-ai/core/filesystem/search"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const provide = (directory: string) =>
  Effect.provide(
    FileSystem.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          FSUtil.defaultLayer,
          Ripgrep.defaultLayer,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
      ),
    ),
  )

const withTmp = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))

const captureSearchIndexLimit = (directory: string, vcs?: Location.Interface["vcs"]) => {
  const observed = { limit: 0 }
  return Effect.gen(function* () {
    const service = yield* FileSystem.Service
    yield* service.find(new FileSystem.FindInput({ query: "text", limit: 10 }))
    return observed.limit
  }).pipe(
    Effect.provide(
      FileSystem.baseLayer(
        FileSystemSearch.ripgrepLayer.pipe(
          Layer.provide(
            Layer.succeed(
              Ripgrep.Service,
              Ripgrep.Service.of({
                find: (input) =>
                  Effect.sync(() => {
                    observed.limit = input.limit
                    return []
                  }),
                glob: () => Effect.succeed([]),
                grep: () => Effect.succeed([]),
              }),
            ),
          ),
        ),
      ).pipe(
        Layer.provide(FSUtil.defaultLayer),
        Layer.provide(
          Layer.succeed(
            Location.Service,
            Location.Service.of(location({ directory: AbsolutePath.make(directory) }, { vcs })),
          ),
        ),
      ),
    ),
  )
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
        const entries = yield* (yield* FileSystem.Service).list()
        expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("src" + path.sep), type: "directory" },
          { path: RelativePath.make("README.md"), type: "file" },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects lexical escapes", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const result = yield* (yield* FileSystem.Service)
          .read({ path: RelativePath.make("../outside.txt") })
          .pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects search paths that escape the location", () =>
    withTmp((directory) =>
      withTmp((outsideDirectory) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.writeFile(path.join(outsideDirectory, "outside.txt"), "needle"))
          const service = yield* FileSystem.Service
          const outside = RelativePath.make(path.relative(directory, outsideDirectory))
          const glob = yield* service
            .glob(new FileSystem.GlobInput({ pattern: "*.txt", path: outside }))
            .pipe(Effect.exit)
          const grep = yield* service
            .grep(new FileSystem.GrepInput({ pattern: "needle", path: outside }))
            .pipe(Effect.exit)
          expect(Exit.isFailure(glob)).toBe(true)
          expect(Exit.isFailure(grep)).toBe(true)
        }).pipe(provide(directory)),
      ),
    ),
  )

  it.live("does not initialize search when reading files", () =>
    withTmp((directory) => {
      let searchInitializations = 0
      return Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "text.txt"), "hello"))
        const service = yield* FileSystem.Service
        const text = yield* service.read({ path: RelativePath.make("text.txt") })
        expect(new TextDecoder().decode(text.content)).toBe("hello")
        expect(searchInitializations).toBe(0)
        expect(yield* service.find(new FileSystem.FindInput({ query: "text", limit: 10 }))).toEqual([])
        expect(searchInitializations).toBe(1)
      }).pipe(
        Effect.provide(
          FileSystem.baseLayer(
            Layer.effect(
              FileSystemSearch.Service,
              Effect.sync(() => {
                searchInitializations += 1
                return FileSystemSearch.Service.of({
                  find: () => Effect.succeed([]),
                  glob: () => Effect.succeed([]),
                  grep: () => Effect.succeed([]),
                })
              }),
            ),
          ).pipe(
            Layer.provide(FSUtil.defaultLayer),
            Layer.provide(
              Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
              ),
            ),
          ),
        ),
      )
    }),
  )

  it.live("does not initialize search when listing files", () =>
    withTmp((directory) => {
      let searchInitializations = 0
      return Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "text.txt"), "hello"))
        const service = yield* FileSystem.Service
        expect(yield* service.list()).toEqual([
          new FileSystem.Entry({
            path: RelativePath.make("text.txt"),
            type: "file",
            mime: "text/plain",
          }),
        ])
        expect(searchInitializations).toBe(0)
      }).pipe(
        Effect.provide(
          FileSystem.baseLayer(
            Layer.effect(
              FileSystemSearch.Service,
              Effect.sync(() => {
                searchInitializations += 1
                return FileSystemSearch.Service.of({
                  find: () => Effect.succeed([]),
                  glob: () => Effect.succeed([]),
                  grep: () => Effect.succeed([]),
                })
              }),
            ),
          ).pipe(
            Layer.provide(FSUtil.defaultLayer),
            Layer.provide(
              Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
              ),
            ),
          ),
        ),
      )
    }),
  )

  it.live("reuses initialized search for repeated searches", () =>
    withTmp((directory) => {
      let searchInitializations = 0
      return Effect.gen(function* () {
        const service = yield* FileSystem.Service
        yield* service.find(new FileSystem.FindInput({ query: "text", limit: 10 }))
        yield* service.find(new FileSystem.FindInput({ query: "text", limit: 10 }))
        expect(searchInitializations).toBe(1)
      }).pipe(
        Effect.provide(
          FileSystem.baseLayer(
            Layer.effect(
              FileSystemSearch.Service,
              Effect.sync(() => {
                searchInitializations += 1
                return FileSystemSearch.Service.of({
                  find: () => Effect.succeed([]),
                  glob: () => Effect.succeed([]),
                  grep: () => Effect.succeed([]),
                })
              }),
            ),
          ).pipe(
            Layer.provide(FSUtil.defaultLayer),
            Layer.provide(
              Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
              ),
            ),
          ),
        ),
      )
    }),
  )

  it.live("keeps lazy search resources alive until the file system layer closes", () =>
    withTmp((directory) => {
      let searchInitializations = 0
      let searchFinalizations = 0
      return Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const service = yield* FileSystem.Service
          yield* service.find(new FileSystem.FindInput({ query: "text", limit: 10 }))
          expect(searchInitializations).toBe(1)
          expect(searchFinalizations).toBe(0)
        }).pipe(
          Effect.provide(
            FileSystem.baseLayer(
              Layer.effect(
                FileSystemSearch.Service,
                Effect.gen(function* () {
                  searchInitializations += 1
                  yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      searchFinalizations += 1
                    }),
                  )
                  return FileSystemSearch.Service.of({
                    find: () => Effect.succeed([]),
                    glob: () => Effect.succeed([]),
                    grep: () => Effect.succeed([]),
                  })
                }),
              ),
            ).pipe(
              Layer.provide(FSUtil.defaultLayer),
              Layer.provide(
                Layer.succeed(
                  Location.Service,
                  Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
                ),
              ),
            ),
          ),
        )
        expect(searchFinalizations).toBe(1)
      })
    }),
  )

  it.live("initializes search once for concurrent first searches", () =>
    withTmp((directory) => {
      let searchInitializations = 0
      return Effect.gen(function* () {
        const service = yield* FileSystem.Service
        yield* Effect.all(
          [
            service.find(new FileSystem.FindInput({ query: "text", limit: 10 })),
            service.find(new FileSystem.FindInput({ query: "text", limit: 10 })),
          ],
          { concurrency: "unbounded" },
        )
        expect(searchInitializations).toBe(1)
      }).pipe(
        Effect.provide(
          FileSystem.baseLayer(
            Layer.effect(
              FileSystemSearch.Service,
              Effect.gen(function* () {
                searchInitializations += 1
                yield* Effect.promise(() => Bun.sleep(20))
                return FileSystemSearch.Service.of({
                  find: () => Effect.succeed([]),
                  glob: () => Effect.succeed([]),
                  grep: () => Effect.succeed([]),
                })
              }),
            ),
          ).pipe(
            Layer.provide(FSUtil.defaultLayer),
            Layer.provide(
              Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
              ),
            ),
          ),
        ),
      )
    }),
  )

  it.live("loads search results before the first find", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "hello.txt"), "needle"))
        const found = yield* (yield* FileSystem.Service).find(
          new FileSystem.FindInput({ query: "hello", type: "file", limit: 10 }),
        )
        expect(found.map((entry) => entry.path)).toContain(RelativePath.make("hello.txt"))
      }).pipe(
        Effect.provide(
          FileSystem.baseLayer(FileSystemSearch.ripgrepLayer.pipe(Layer.provide(Ripgrep.defaultLayer))).pipe(
            Layer.provide(FSUtil.defaultLayer),
            Layer.provide(
              Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
              ),
            ),
          ),
        ),
      ),
    ),
  )

  it.live("preserves the existing search indexing limits for VCS and non-VCS locations", () =>
    withTmp((gitDirectory) =>
      withTmp((plainDirectory) =>
        Effect.gen(function* () {
          const git = yield* captureSearchIndexLimit(gitDirectory, {
            type: "git",
            store: AbsolutePath.make(path.join(gitDirectory, ".git")),
          })
          const plain = yield* captureSearchIndexLimit(plainDirectory)
          expect(git).toBe(Number.MAX_SAFE_INTEGER)
          expect(plain).toBe(100_000)
        }),
      ),
    ),
  )
})
