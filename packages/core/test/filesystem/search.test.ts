import { describe, expect, spyOn } from "bun:test"
import fuzzysort from "fuzzysort"
import { mkdir } from "node:fs/promises"
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
import { Workspace } from "@opencode-ai/core/workspace"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { it } from "../lib/effect"

const ripgrepStub = (entry: string, onFind: (input: Ripgrep.FindInput) => void) =>
  Layer.succeed(
    Ripgrep.Service,
    Ripgrep.Service.of({
      find: (input) =>
        Effect.gen(function* () {
          onFind(input)
          if (input.onEntry)
            yield* input.onEntry(FileSystem.Entry.make({ path: RelativePath.make(entry), type: "file" }))
          return []
        }),
      glob: () => Effect.succeed([]),
      grep: () => Effect.succeed([]),
    }),
  )

describe("FileSystemSearch", () => {
  it.live("honors wildcard directory rules from .gitignore", () =>
    Effect.gen(function* () {
      const directory = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-fff-ignore-")))).path
      yield* Effect.promise(() => mkdir(path.join(directory, "rust/target/debug/deps"), { recursive: true }))
      yield* Effect.promise(() => Bun.write(path.join(directory, ".gitignore"), "**/target/\n"))
      yield* Effect.promise(() => Bun.write(path.join(directory, "rust/target/debug/deps/ignored.rs"), "ignored"))
      expect(Bun.spawnSync(["git", "init", "-q"], { cwd: directory }).exitCode).toBe(0)

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
      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        const entries = yield* search.find({ query: "target" })
        expect(entries.every((entry) => !entry.path.startsWith("rust/target/"))).toBe(true)
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("selects the ripgrep layer for workspace-backed locations even when vcs would pick fff", () =>
    Effect.gen(function* () {
      const directory = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-search-workspace-"))))
        .path
      // A local file that only an fff index of the server directory could surface.
      // The fff-vs-ripgrep discrimination only bites where Fff.available() is
      // true; elsewhere the layer choice already falls back to ripgrep.
      yield* Effect.promise(() => Bun.write(path.join(directory, "server-local.ts"), "server local"))
      let observed: Ripgrep.FindInput | undefined
      const ref = Location.Ref.make({
        directory: AbsolutePath.make(directory),
        workspaceID: Workspace.ID.make("wrk_test"),
      })
      const layer = AppNodeBuilder.build(FileSystemSearch.node, [
        [
          Location.node,
          Layer.succeed(
            Location.Service,
            Location.Service.of(
              location(ref, { vcs: { type: "git", store: AbsolutePath.make(path.join(directory, ".git")) } }),
            ),
          ),
        ],
        [Ripgrep.node, ripgrepStub("remote.ts", (input) => (observed = input))],
      ])

      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        const entries = yield* search.find({ query: "ts", type: "file" })
        expect(observed?.cwd).toBe(directory)
        expect(entries.map((entry) => entry.path)).toEqual([RelativePath.make("remote.ts")])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("bounds a home scan even when home is detected as a repository", () =>
    Effect.gen(function* () {
      let observed: Ripgrep.FindInput | undefined
      const home = AbsolutePath.make(os.homedir())
      const layer = AppNodeBuilder.build(FileSystemSearch.node, [
        [
          Location.node,
          Layer.succeed(
            Location.Service,
            Location.Service.of(
              location(
                { directory: home },
                { vcs: { type: "git", store: AbsolutePath.make(path.join(home, ".git")) } },
              ),
            ),
          ),
        ],
        [Ripgrep.node, ripgrepStub("src/index.ts", (input) => (observed = input))],
      ])
      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        yield* Effect.sleep("10 millis")
        expect(observed).toBeUndefined()
        yield* search.find({ query: "src", type: "directory" })
        expect(observed?.limit).toBe(100_000)
        expect(observed?.exclude).toEqual([...Protected.names()].map((name) => `${name}/**`))
        expect((yield* search.find({ query: "src", type: "directory" }))[0]?.path).toBe(
          RelativePath.make(`src${path.sep}`),
        )
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect("refreshes a stale ripgrep index atomically without blocking search", () =>
    Effect.gen(function* () {
      let scans = 0
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
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

      yield* Effect.gen(function* () {
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
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect("reuses location-owned fuzzy targets across index refreshes", () =>
    Effect.gen(function* () {
      let scans = 0
      const second = yield* Deferred.make<void>()
      const prepare = yield* Effect.acquireRelease(
        Effect.sync(() => spyOn(fuzzysort, "prepare")),
        (value) => Effect.sync(() => value.mockRestore()),
      )
      const cleanup = yield* Effect.acquireRelease(
        Effect.sync(() => spyOn(fuzzysort, "cleanup")),
        (value) => Effect.sync(() => value.mockRestore()),
      )
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

      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        yield* search.find({ query: "index", type: "file" })
        yield* TestClock.adjust("10 seconds")
        yield* search.find({ query: "index", type: "file" })
        yield* Deferred.await(second)
        yield* search.find({ query: "index", type: "file" })

        expect(prepare).toHaveBeenCalledTimes(2)
        expect(cleanup).toHaveBeenCalledTimes(3)
      }).pipe(Effect.provide(layer))
    }),
  )
})
