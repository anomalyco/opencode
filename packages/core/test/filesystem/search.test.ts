import { describe, expect, spyOn, test } from "bun:test"
import fuzzysort from "fuzzysort"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "os"
import path from "path"
import { Deferred, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Protected } from "@opencode-ai/core/filesystem/protected"
import { FileSystemSearch } from "@opencode-ai/core/filesystem/search"
import { Location } from "@opencode-ai/core/location"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"

describe("FileSystemSearch", () => {
  test("honors wildcard directory rules from .gitignore", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-fff-ignore-"))
    try {
      await mkdir(path.join(directory, "rust/target/debug/deps"), { recursive: true })
      await Bun.write(path.join(directory, ".gitignore"), "**/target/\n")
      await Bun.write(path.join(directory, "rust/target/debug/deps/ignored.rs"), "ignored")
      const git = Bun.spawnSync(["git", "init", "-q"], { cwd: directory })
      expect(git.exitCode).toBe(0)

      const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })
      const layer = FileSystemSearch.fffLayer.pipe(
        Layer.provide(
          Layer.succeed(
            Location.Service,
            Location.Service.of(
              location(ref, {
                vcs: { type: "git", store: AbsolutePath.make(path.join(directory, ".git")) },
              }),
            ),
          ),
        ),
      )
      const entries = await Effect.runPromise(
        Effect.gen(function* () {
          const search = yield* FileSystemSearch.Service
          return yield* search.find({ query: "target" })
        }).pipe(Effect.provide(layer), Effect.scoped),
      )

      expect(entries.every((entry) => !entry.path.startsWith("rust/target/"))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("bounds a home scan even when home is detected as a repository", async () => {
    let observed: Ripgrep.FindInput | undefined
    const home = AbsolutePath.make(os.homedir())
    const layer = AppNodeBuilder.build(FileSystemSearch.node, [
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of(
            location({ directory: home }, { vcs: { type: "git", store: AbsolutePath.make(path.join(home, ".git")) } }),
          ),
        ),
      ],
      [
        Ripgrep.node,
        Layer.succeed(
          Ripgrep.Service,
          Ripgrep.Service.of({
            find: (input) =>
              Effect.gen(function* () {
                observed = input
                if (input.onEntry)
                  yield* input.onEntry(FileSystem.Entry.make({ path: RelativePath.make("src/index.ts"), type: "file" }))
                return []
              }),
            glob: () => Effect.succeed([]),
            grep: () => Effect.succeed([]),
          }),
        ),
      ],
    ])

    await Effect.runPromise(
      Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        yield* Effect.sleep("10 millis")
        expect(observed).toBeUndefined()
        yield* search.find({ query: "src", type: "directory" })
        expect(observed?.limit).toBe(100_000)
        expect(observed?.exclude).toEqual([...Protected.names()].map((name) => `${name}/**`))
        expect((yield* search.find({ query: "src", type: "directory" }))[0]?.path).toBe(
          RelativePath.make(`src${path.sep}`),
        )
      }).pipe(Effect.provide(layer), Effect.scoped),
    )
  })

  test("refreshes a stale ripgrep index atomically without blocking search", async () => {
    let scans = 0
    const started = Effect.runSync(Deferred.make<void>())
    const release = Effect.runSync(Deferred.make<void>())
    const layer = AppNodeBuilder.build(FileSystemSearch.node, [
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of(
            location({ directory: AbsolutePath.make(path.join(os.tmpdir(), "opencode-search-atomic")) }),
          ),
        ),
      ],
      [
        Ripgrep.node,
        Layer.succeed(
          Ripgrep.Service,
          Ripgrep.Service.of({
            find: (input) =>
              Effect.gen(function* () {
                scans++
                if (scans > 1) {
                  yield* Deferred.succeed(started, undefined)
                  yield* Deferred.await(release)
                }
                const entry = FileSystem.Entry.make({
                  path: RelativePath.make(scans === 1 ? "src/old.ts" : "src/new.ts"),
                  type: "file",
                })
                if (input.onEntry) yield* input.onEntry(entry)
                return [entry]
              }),
            glob: () => Effect.succeed([]),
            grep: () => Effect.succeed([]),
          }),
        ),
      ],
    ])

    await Effect.runPromise(
      Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        yield* search.find({ query: "old", type: "file" })
        expect((yield* search.find({ query: "old", type: "file" }))[0]?.path).toBe(RelativePath.make("src/old.ts"))
        expect(scans).toBe(1)

        yield* TestClock.adjust("10 seconds")
        yield* search.find({ query: "old", type: "file" })
        yield* Deferred.await(started)

        expect((yield* search.find({ query: "old", type: "file" }))[0]?.path).toBe(RelativePath.make("src/old.ts"))
        expect(scans).toBe(2)
        yield* Deferred.succeed(release, undefined)
        const refreshed = yield* Effect.gen(function* () {
          yield* Effect.yieldNow
          return yield* search.find({ query: "new", type: "file" })
        }).pipe(Effect.repeat({ until: (entries) => entries.length > 0 }))
        expect(refreshed[0]?.path).toBe(RelativePath.make("src/new.ts"))
        expect(scans).toBe(2)
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer()), Effect.scoped),
    )
  })

  test("reuses location-owned fuzzy targets across index refreshes", async () => {
    let scans = 0
    const second = Effect.runSync(Deferred.make<void>())
    const prepare = spyOn(fuzzysort, "prepare")
    const cleanup = spyOn(fuzzysort, "cleanup")
    const layer = AppNodeBuilder.build(FileSystemSearch.node, [
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of(
            location({ directory: AbsolutePath.make(path.join(os.tmpdir(), "opencode-search-cache")) }),
          ),
        ),
      ],
      [
        Ripgrep.node,
        Layer.succeed(
          Ripgrep.Service,
          Ripgrep.Service.of({
            find: (input) =>
              Effect.gen(function* () {
                scans++
                const entry = FileSystem.Entry.make({ path: RelativePath.make("src/index.ts"), type: "file" })
                if (input.onEntry) yield* input.onEntry(entry)
                if (scans > 1) yield* Deferred.succeed(second, undefined)
                return [entry]
              }),
            glob: () => Effect.succeed([]),
            grep: () => Effect.succeed([]),
          }),
        ),
      ],
    ])

    await Effect.runPromise(
      Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        yield* search.find({ query: "index", type: "file" })
        yield* TestClock.adjust("10 seconds")
        yield* search.find({ query: "index", type: "file" })
        yield* Deferred.await(second)
        yield* search.find({ query: "index", type: "file" })

        expect(prepare).toHaveBeenCalledTimes(2)
        expect(cleanup).toHaveBeenCalledTimes(3)
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer()), Effect.scoped),
    )
    prepare.mockRestore()
    cleanup.mockRestore()
  })
})
