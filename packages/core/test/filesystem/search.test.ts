import { describe, expect, spyOn } from "bun:test"
import fuzzysort from "fuzzysort"
import { mkdir } from "node:fs/promises"
import os from "os"
import path from "path"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scheduler, Scope } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { FileSystem } from "@opencode/core/filesystem"
import { Protected } from "@opencode/core/filesystem/protected"
import { FileSystemSearch } from "@opencode/core/filesystem/search"
import { Location } from "@opencode/core/location"
import { Ripgrep } from "@opencode/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { Workspace } from "@opencode/core/workspace"
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

const fakeFff = () => {
  const state = { scanning: true, files: [] as string[], created: 0, destroyed: 0 }
  const create: Parameters<typeof FileSystemSearch.makeFffLayer>[0] = () => {
    state.created++
    const search = () => ({
      ok: true as const,
      value: {
        items: state.files.map((relativePath) => ({ relativePath })),
        scores: state.files.map(() => ({ total: 1 })),
      },
    })
    return {
      ok: true,
      value: {
        destroy: () => void state.destroyed++,
        isScanning: () => state.scanning,
        fileSearch: search,
        directorySearch: () => ({ ok: true, value: { items: [], scores: [] } }),
        mixedSearch: () => ({ ok: true, value: { items: [], scores: [] } }),
      },
    }
  }
  const layer = FileSystemSearch.makeFffLayer(create).pipe(
    Layer.provide(
      Layer.succeed(
        Location.Service,
        Location.Service.of(location({ directory: AbsolutePath.make(path.join(os.tmpdir(), "opencode-fff-fake")) })),
      ),
    ),
  )
  return { state, layer }
}

const buildSearch = (layer: Layer.Layer<FileSystemSearch.Service>) =>
  Effect.gen(function* () {
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
    const context = yield* Layer.buildWithScope(layer, scope)
    return { scope, search: Context.get(context, FileSystemSearch.Service) }
  })

const findFiles = (search: FileSystemSearch.Interface) =>
  search.find({ query: "src", type: "file" }).pipe(Effect.map((entries) => entries.map((entry) => entry.path)))

const ripgrepSearch = (find: Ripgrep.Interface["find"]) =>
  AppNodeBuilder.build(FileSystemSearch.configured({ fff: false }), [
    Location.node.replace(
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location(
            { directory: AbsolutePath.make(path.join(os.tmpdir(), "opencode-search-budget")) },
            { vcs: { type: "git", store: AbsolutePath.make(path.join(os.tmpdir(), "opencode-search-budget/.git")) } },
          ),
        ),
      ),
    ),
    Ripgrep.node.replace(
      Layer.succeed(
        Ripgrep.Service,
        Ripgrep.Service.of({ find, glob: () => Effect.succeed([]), grep: () => Effect.succeed([]) }),
      ),
    ),
  ])

const emit = (input: Ripgrep.FindInput, file: string) =>
  input.onEntry?.(FileSystem.Entry.make({ path: RelativePath.make(file), type: "file" })) ?? Effect.void

describe("FileSystemSearch", () => {
  it.effect("returns partial cold ripgrep results within budget while the index keeps growing", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      let scans = 0
      const layer = ripgrepSearch((input) =>
        Effect.gen(function* () {
          scans++
          yield* emit(input, "src/first.ts")
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
          yield* emit(input, "src/second.ts")
          return []
        }),
      )
      const { search } = yield* buildSearch(layer)
      const pending = yield* Effect.forkChild(findFiles(search))
      yield* Deferred.await(started)
      yield* TestClock.adjust("50 millis")
      const concurrent = yield* Effect.forkChild(findFiles(search))
      yield* TestClock.adjust("50 millis")
      expect(pending.pollUnsafe()).toBeDefined()
      expect(concurrent.pollUnsafe()).toBeDefined()
      expect(yield* Fiber.join(pending)).toEqual([RelativePath.make("src/first.ts")])
      expect(yield* Fiber.join(concurrent)).toEqual([RelativePath.make("src/first.ts")])

      // Subsequent keystrokes use the live partial index without another wait.
      expect(yield* findFiles(search)).toEqual([RelativePath.make("src/first.ts")])
      yield* TestClock.adjust("10 seconds")
      yield* Deferred.succeed(release, undefined)
      yield* TestClock.adjust("1 millis")
      expect(yield* findFiles(search)).toEqual([RelativePath.make("src/first.ts"), RelativePath.make("src/second.ts")])
      expect(scans).toBe(1)
    }),
  )

  it.effect("finishes a slow shared scan after request cancellation without capping git repositories", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let scans = 0
      let finalized = 0
      const layer = ripgrepSearch((input) =>
        Effect.gen(function* () {
          scans++
          expect(input.limit).toBe(Number.MAX_SAFE_INTEGER)
          yield* emit(input, scans === 1 ? "src/partial.ts" : "src/refreshed.ts")
          if (scans > 1) return []
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
          yield* emit(input, "src/late.ts")
          return []
        }).pipe(Effect.ensuring(Effect.sync(() => finalized++))),
      )
      const { search } = yield* buildSearch(layer)
      const cancelled = yield* Effect.forkChild(findFiles(search))
      yield* Deferred.await(started)
      const waiting = yield* Effect.forkChild(findFiles(search))
      yield* Fiber.interrupt(cancelled)
      expect(finalized).toBe(0)
      yield* TestClock.adjust("100 millis")
      expect(waiting.pollUnsafe()).toBeDefined()
      expect(yield* Fiber.join(waiting)).toEqual([RelativePath.make("src/partial.ts")])
      expect(scans).toBe(1)

      yield* TestClock.adjust("10 seconds")
      expect(finalized).toBe(0)
      expect(yield* findFiles(search)).toEqual([RelativePath.make("src/partial.ts")])
      expect(scans).toBe(1)
      yield* Deferred.succeed(release, undefined)
      yield* TestClock.adjust("1 millis")
      expect(finalized).toBe(1)
      expect(yield* findFiles(search)).toEqual([RelativePath.make("src/late.ts"), RelativePath.make("src/partial.ts")])
      yield* TestClock.adjust("10 seconds")
      yield* findFiles(search)
      yield* TestClock.adjust("1 millis")
      expect(yield* findFiles(search)).toEqual([RelativePath.make("src/refreshed.ts")])
      expect(scans).toBe(2)
    }),
  )

  it.effect("interrupts an in-flight scan when its location closes", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      let finalized = false
      const layer = ripgrepSearch(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Effect.sync(() => {
              finalized = true
            }),
          ),
        ),
      )
      const { scope, search } = yield* buildSearch(layer)
      const pending = yield* Effect.forkChild(findFiles(search))
      yield* Deferred.await(started)
      yield* Scope.close(scope, Exit.void)
      expect(finalized).toBe(true)
      expect(Exit.isFailure(yield* Fiber.await(pending))).toBe(true)
    }),
  )

  it.effect("retains warm ranked results when a refresh times out and replaces them on success", () =>
    Effect.gen(function* () {
      let scans = 0
      let finalized = 0
      const layer = ripgrepSearch((input) =>
        Effect.gen(function* () {
          scans++
          if (scans === 1) {
            yield* emit(input, "src/search-other.ts")
            yield* emit(input, "src/search.ts")
            return []
          }
          yield* emit(input, "src/search-new.ts")
          if (scans === 2) return yield* Effect.never
          return []
        }).pipe(Effect.ensuring(Effect.sync(() => finalized++))),
      )
      const { search } = yield* buildSearch(layer)
      const ranked = () => search.find({ query: "search.ts", type: "file" })
      expect((yield* ranked())[0]?.path).toBe(RelativePath.make("src/search.ts"))
      expect((yield* search.find({ query: "src", type: "directory" })).map((entry) => entry.path)).toEqual([
        RelativePath.make(`src${path.sep}`),
      ])

      yield* TestClock.adjust("10 seconds")
      expect((yield* ranked())[0]?.path).toBe(RelativePath.make("src/search.ts"))
      yield* TestClock.adjust("5 seconds")
      expect(scans).toBe(2)
      expect(finalized).toBe(2)
      expect((yield* ranked())[0]?.path).toBe(RelativePath.make("src/search.ts"))

      yield* TestClock.adjust("10 seconds")
      yield* ranked()
      yield* TestClock.adjust("1 millis")
      expect((yield* ranked()).map((entry) => entry.path)).toEqual([RelativePath.make("src/search-new.ts")])
      expect(scans).toBe(3)
    }),
  )

  it.live("yields to the event loop while preparing a buffered file stream", () =>
    Effect.gen(function* () {
      let prepared = 0
      let observed = 0
      const layer = ripgrepSearch((input) =>
        Effect.gen(function* () {
          const heartbeat = yield* Effect.forkChild(
            Effect.callback<void>((resume) => {
              const timer = setImmediate(() => {
                observed = prepared
                resume(Effect.void)
              })
              return Effect.sync(() => clearImmediate(timer))
            }),
            { startImmediately: true },
          )
          for (let i = 0; i < 1_024; i++) {
            yield* emit(input, `src/entry-${i}.ts`)
            prepared++
          }
          yield* Fiber.join(heartbeat)
          return []
        }).pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, Number.POSITIVE_INFINITY)),
      )
      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        yield* findFiles(search)
        expect(observed).toBeGreaterThan(0)
        expect(observed).toBeLessThan(128)
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect("creates the fff picker on first search and waits for its initial scan", () =>
    Effect.gen(function* () {
      const fff = fakeFff()
      const { scope, search } = yield* buildSearch(fff.layer)
      expect(fff.state.created).toBe(0)

      const pending = yield* Effect.forkChild(findFiles(search))
      yield* TestClock.adjust("100 millis")
      expect(fff.state.created).toBe(1)
      expect(pending.pollUnsafe()).toBeUndefined()

      fff.state.files = ["src/a.ts", "src/b.ts"]
      fff.state.scanning = false
      yield* TestClock.adjust("20 millis")
      expect(yield* Fiber.join(pending)).toEqual([RelativePath.make("src/a.ts"), RelativePath.make("src/b.ts")])
      expect(fff.state.created).toBe(1)

      yield* Scope.close(scope, Exit.void)
      expect(fff.state.destroyed).toBe(1)
    }),
  )

  it.effect("returns partial fff results once the initial scan wait times out", () =>
    Effect.gen(function* () {
      const fff = fakeFff()
      fff.state.files = ["src/a.ts"]
      const { scope, search } = yield* buildSearch(fff.layer)

      const pending = yield* Effect.forkChild(findFiles(search))
      yield* TestClock.adjust("2900 millis")
      expect(pending.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("100 millis")
      expect(yield* Fiber.join(pending)).toEqual([RelativePath.make("src/a.ts")])

      // The picker is still scanning, but later searches no longer wait for it.
      const next = yield* Effect.forkChild(findFiles(search))
      yield* TestClock.adjust("1 millis")
      expect(next.pollUnsafe()).toBeDefined()
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("keeps the fff picker owned by the layer when the first search is interrupted", () =>
    Effect.gen(function* () {
      const fff = fakeFff()
      const { scope, search } = yield* buildSearch(fff.layer)

      const pending = yield* Effect.forkChild(findFiles(search))
      yield* TestClock.adjust("100 millis")
      yield* Fiber.interrupt(pending)
      expect(fff.state.created).toBe(1)
      expect(fff.state.destroyed).toBe(0)

      fff.state.files = ["src/a.ts"]
      fff.state.scanning = false
      const next = yield* Effect.forkChild(findFiles(search))
      yield* TestClock.adjust("20 millis")
      expect(yield* Fiber.join(next)).toEqual([RelativePath.make("src/a.ts")])
      expect(fff.state.created).toBe(1)

      yield* Scope.close(scope, Exit.void)
      expect(fff.state.destroyed).toBe(1)
      expect(yield* findFiles(search)).toEqual([])
      expect(fff.state.created).toBe(1)
    }),
  )

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

  it.live("real fff finds files on first search", () =>
    Effect.gen(function* () {
      const directory = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-fff-lazy-")))).path
      yield* Effect.promise(() => Bun.write(path.join(directory, "src/existing-alpha.ts"), "alpha"))
      expect(Bun.spawnSync(["git", "init", "-q"], { cwd: directory }).exitCode).toBe(0)

      const ref = Location.Ref.make({ directory: AbsolutePath.make(directory) })
      const layer = FileSystemSearch.fffLayer.pipe(
        Layer.provide(
          Layer.succeed(
            Location.Service,
            Location.Service.of(
              location(ref, { vcs: { type: "git", store: AbsolutePath.make(path.join(directory, ".git")) } }),
            ),
          ),
        ),
      )
      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        const found = yield* search
          .find({ query: "existing-alpha", type: "file" })
          .pipe(Effect.map((entries) => entries.map((entry) => entry.path)))
        expect(found).toContain(RelativePath.make("src/existing-alpha.ts"))
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
        Location.node.replace(
          Layer.succeed(
            Location.Service,
            Location.Service.of(
              location(ref, { vcs: { type: "git", store: AbsolutePath.make(path.join(directory, ".git")) } }),
            ),
          ),
        ),
        Ripgrep.node.replace(ripgrepStub("remote.ts", (input) => (observed = input))),
      ])

      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        const entries = yield* search.find({ query: "ts", type: "file" })
        expect(observed?.cwd).toBe(directory)
        expect(observed?.hidden).toBe(true)
        expect(entries.map((entry) => entry.path)).toEqual([RelativePath.make("remote.ts")])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("bounds a home scan even when home is detected as a repository", () =>
    Effect.gen(function* () {
      let observed: Ripgrep.FindInput | undefined
      const home = AbsolutePath.make(os.homedir())
      const layer = AppNodeBuilder.build(FileSystemSearch.node, [
        Location.node.replace(
          Layer.succeed(
            Location.Service,
            Location.Service.of(
              location(
                { directory: home },
                { vcs: { type: "git", store: AbsolutePath.make(path.join(home, ".git")) } },
              ),
            ),
          ),
        ),
        Ripgrep.node.replace(ripgrepStub("src/index.ts", (input) => (observed = input))),
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
        Location.node.replace(
          Layer.succeed(
            Location.Service,
            Location.Service.of(
              location({ directory: AbsolutePath.make(path.join(os.tmpdir(), "opencode-search-atomic")) }),
            ),
          ),
        ),
        Ripgrep.node.replace(
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
        ),
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
        Location.node.replace(
          Layer.succeed(
            Location.Service,
            Location.Service.of(
              location({ directory: AbsolutePath.make(path.join(os.tmpdir(), "opencode-search-cache")) }),
            ),
          ),
        ),
        Ripgrep.node.replace(
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
        ),
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
