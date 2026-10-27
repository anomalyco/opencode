import { describe, expect, spyOn } from "bun:test"
import fuzzysort from "fuzzysort"
import { mkdir, symlink } from "node:fs/promises"
import os from "os"
import path from "path"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
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
    const scope = yield* Scope.make()
    const context = yield* Layer.buildWithScope(layer, scope)
    return { scope, search: Context.get(context, FileSystemSearch.Service) }
  })

const findFiles = (search: FileSystemSearch.Interface) =>
  search.find({ query: "src", type: "file" }).pipe(Effect.map((entries) => entries.map((entry) => entry.path)))

describe("FileSystemSearch", () => {
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

  // Symlink creation needs elevated privileges on Windows.
  ;(process.platform === "win32" ? it.live.skip : it.live)(
    "indexes symlinks to files without following symlinked directories",
    () =>
      Effect.gen(function* () {
        const directory = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-search-symlink-"))))
          .path
        yield* Effect.promise(async () => {
          await Bun.write(path.join(directory, ".agents/AGENTS.md"), "rules")
          await Bun.write(path.join(directory, "app/index.ts"), "app")
          await Bun.write(path.join(directory, ".ignore"), "ignored.md\n")
          await symlink(".agents/AGENTS.md", path.join(directory, "AGENTS.md"))
          await symlink("../.agents/AGENTS.md", path.join(directory, "app/AGENTS.md"))
          await symlink(".agents/AGENTS.md", path.join(directory, "ignored.md"))
          await symlink("app", path.join(directory, "linked"))
          await symlink("missing.md", path.join(directory, "broken.md"))
          await symlink(".", path.join(directory, "loop"))
        })
        const layer = AppNodeBuilder.build(FileSystemSearch.configured({ fff: false }), [
          Location.node.replace(
            Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
          ),
        ])
        yield* Effect.gen(function* () {
          const search = yield* FileSystemSearch.Service
          const find = (query: string, type?: "file" | "directory") =>
            search.find({ query, type }).pipe(Effect.map((entries) => entries.map((entry) => entry.path).sort()))
          expect(yield* find("AGENTS", "file")).toEqual([
            RelativePath.make("AGENTS.md"),
            RelativePath.make("app/AGENTS.md"),
          ])
          expect(yield* find("index", "file")).toEqual([RelativePath.make("app/index.ts")])
          expect(yield* find("ignored", "file")).toEqual([])
          expect(yield* find("broken", "file")).toEqual([])
          expect(yield* find("linked")).toEqual([])
          expect(yield* find("loop")).toEqual([])
        }).pipe(Effect.provide(layer))
      }),
  )

  // Symlink creation needs elevated privileges on Windows.
  ;(process.platform === "win32" ? it.effect.skip : it.effect)(
    "lists only the root, new directories and directories with links on a refresh",
    () =>
      Effect.gen(function* () {
        const directory = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-search-relist-"))))
          .path
        yield* Effect.promise(async () => {
          await Bun.write(path.join(directory, ".agents/AGENTS.md"), "rules")
          await Bun.write(path.join(directory, "app/sub/index.ts"), "app")
          await Bun.write(path.join(directory, "lib/index.ts"), "lib")
          await symlink("../.agents/AGENTS.md", path.join(directory, "lib/AGENTS.md"))
        })
        const listed: string[] = []
        const environment = Environment.node.mapLayer((base) =>
          Layer.effect(
            Environment.Service,
            Effect.map(Environment.Service, (environment) =>
              Environment.Service.of({
                ...environment,
                files: {
                  ...environment.files,
                  list: (value) => {
                    listed.push(path.relative(directory, value))
                    return environment.files.list(value)
                  },
                },
              }),
            ),
          ).pipe(Layer.provide(base)),
        )
        const layer = AppNodeBuilder.build(FileSystemSearch.configured({ fff: false }), [
          Location.node.replace(
            Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
          ),
          Environment.node.replace(environment),
        ])
        yield* Effect.gen(function* () {
          const search = yield* FileSystemSearch.Service
          const find = (query: string) =>
            search
              .find({ query, type: "file" })
              .pipe(Effect.map((entries) => entries.map((entry) => entry.path as string).sort()))
          expect(yield* find("AGENTS")).toEqual(["lib/AGENTS.md"])
          expect(listed.sort()).toEqual(["", "app", "app/sub", "lib"])

          // Links added to the root, to a directory that already holds links and to a new directory are found;
          // the unchanged link-free directories are not listed again.
          yield* Effect.promise(async () => {
            await Bun.write(path.join(directory, "docs/index.ts"), "docs")
            await symlink(".agents/AGENTS.md", path.join(directory, "AGENTS.md"))
            await symlink("../.agents/AGENTS.md", path.join(directory, "lib/CLAUDE.md"))
            await symlink("../.agents/AGENTS.md", path.join(directory, "docs/AGENTS.md"))
          })
          listed.length = 0
          yield* TestClock.adjust("10 seconds")
          const refreshed = yield* Effect.gen(function* () {
            yield* Effect.yieldNow
            return yield* find("md")
          }).pipe(Effect.repeat({ until: (paths) => paths.length === 4 }))
          expect(refreshed).toEqual(["AGENTS.md", "docs/AGENTS.md", "lib/AGENTS.md", "lib/CLAUDE.md"])
          expect(listed.sort()).toEqual(["", "docs", "lib"])
        }).pipe(Effect.provide(layer))
      }),
  )
})
