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
import { initGit } from "../fixture/git"
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

  it.live("discovers empty directories in a git repository", () =>
    Effect.gen(function* () {
      const directory = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-search-empty-")))).path
      const linkType = process.platform === "win32" ? ("junction" as const) : undefined
      yield* Effect.promise(() =>
        Promise.all([
          mkdir(path.join(directory, "emptydir")),
          mkdir(path.join(directory, "keepdir")),
          mkdir(path.join(directory, "nonempty")),
          mkdir(path.join(directory, "src/empty-child"), { recursive: true }),
          mkdir(path.join(directory, "ignored/nested"), { recursive: true }),
          mkdir(path.join(directory, "ignored/empty"), { recursive: true }),
          // Ignored trees that look structurally empty to a listing: only symlinks, hidden entries,
          // or empty scope folders.
          mkdir(path.join(directory, "node_modules/@scope"), { recursive: true }),
          mkdir(path.join(directory, "node_modules/empty"), { recursive: true }),
          mkdir(path.join(directory, "build/empty"), { recursive: true }),
          mkdir(path.join(directory, "linked")),
          mkdir(path.join(directory, "hiddenonly/.cache/store"), { recursive: true }),
        ]),
      )
      yield* Effect.promise(() =>
        Promise.all([
          Bun.write(path.join(directory, ".gitignore"), "ignored/\nnode_modules/\nlinked/\nhiddenonly/\nbuild/\n"),
          Bun.write(path.join(directory, "keepdir/.gitkeep"), ""),
          Bun.write(path.join(directory, "nonempty/file.txt"), "content"),
          Bun.write(path.join(directory, "src/index.ts"), "content"),
          Bun.write(path.join(directory, "ignored/nested/file.txt"), "content"),
          Bun.write(path.join(directory, "hiddenonly/.hidden"), "content"),
          symlink(path.join(directory, "nonempty"), path.join(directory, "linked/symlink"), linkType),
          symlink(
            path.join(directory, "node_modules/empty"),
            path.join(directory, "node_modules/@scope/symlinked"),
            linkType,
          ),
        ]),
      )
      yield* Effect.promise(() => initGit(directory))

      const layer = AppNodeBuilder.build(FileSystemSearch.configured({ fff: false }), [
        Location.node.replace(
          Layer.succeed(
            Location.Service,
            Location.Service.of(
              location(
                { directory: AbsolutePath.make(directory) },
                { vcs: { type: "git", store: AbsolutePath.make(path.join(directory, ".git")) } },
              ),
            ),
          ),
        ),
      ])

      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        expect((yield* search.find({ query: "emptydir", type: "directory" })).map((entry) => entry.path)).toContain(
          RelativePath.make(`emptydir${path.sep}`),
        )
        // keepdir only holds a hidden file, so it must be empty to the directory index.
        expect((yield* search.find({ query: "keepdir", type: "directory" })).map((entry) => entry.path)).toContain(
          RelativePath.make(`keepdir${path.sep}`),
        )
        expect((yield* search.find({ query: "empty-child", type: "directory" })).map((entry) => entry.path)).toContain(
          RelativePath.make(`src/empty-child${path.sep}`),
        )
        expect((yield* search.find({ query: "ignored", type: "directory" })).map((entry) => entry.path)).not.toContain(
          RelativePath.make(`ignored${path.sep}`),
        )
        // The ignored subtree is pruned, so its empty descendant must not leak into the index.
        expect((yield* search.find({ query: "ignored", type: "directory" })).map((entry) => entry.path)).not.toContain(
          RelativePath.make(`ignored/empty${path.sep}`),
        )
        const directories = (query: string) =>
          Effect.map(search.find({ query, type: "directory" }), (entries) => entries.map((entry) => entry.path))
        // Ignored trees that look structurally empty must not be searchable directories.
        const nodeModules = yield* directories("node_modules")
        expect(nodeModules).not.toContain(RelativePath.make(`node_modules${path.sep}`))
        expect(nodeModules).not.toContain(RelativePath.make(`node_modules/@scope${path.sep}`))
        expect(nodeModules).not.toContain(RelativePath.make(`node_modules/empty${path.sep}`))
        const build = yield* directories("build")
        expect(build).not.toContain(RelativePath.make(`build${path.sep}`))
        expect(build).not.toContain(RelativePath.make(`build/empty${path.sep}`))
        expect(yield* directories("linked")).not.toContain(RelativePath.make(`linked${path.sep}`))
        expect(yield* directories("hiddenonly")).not.toContain(RelativePath.make(`hiddenonly${path.sep}`))
        const mixed = yield* search.find({ query: "emptydir" })
        expect(mixed.map((entry) => entry.path)).toContain(RelativePath.make(`emptydir${path.sep}`))
        expect(mixed.every((entry) => entry.type === "directory")).toBe(true)
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
      const driver = Environment.makeMemoryDriver()
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
        Environment.node.replace(
          Layer.succeed(
            Environment.Service,
            Environment.Service.of({
              files: { ...Environment.makeFiles(driver), list: () => Effect.succeed([]) },
              spawner: driver.spawner,
            }),
          ),
        ),
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
      const driver = Environment.makeMemoryDriver()
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
        // Keep the directory walk off the real home directory; this test only covers the ripgrep bounds.
        Environment.node.replace(
          Layer.succeed(
            Environment.Service,
            Environment.Service.of({
              files: { ...Environment.makeFiles(driver), list: () => Effect.succeed([]) },
              spawner: driver.spawner,
            }),
          ),
        ),
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

  it.live("finds empty directories through the location environment without protected home names", () => {
    // The memory driver resolves POSIX paths, so it cannot mirror a native Windows home path.
    if (process.platform === "win32") return Effect.void
    const driver = Environment.makeMemoryDriver()
    const files = Environment.makeFiles(driver)
    const home = os.homedir()
    return Effect.gen(function* () {
      yield* files.mkdir(path.join(home, "Documents"))
      yield* files.mkdir(path.join(home, "code", "emptydir"))
      const layer = AppNodeBuilder.build(FileSystemSearch.configured({ fff: false }), [
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(home) }))),
        ),
        Ripgrep.node.replace(ripgrepStub("src/index.ts", () => {})),
        Environment.node.replace(
          Layer.succeed(Environment.Service, Environment.Service.of({ files, spawner: driver.spawner })),
        ),
      ])

      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        expect((yield* search.find({ query: "emptydir", type: "directory" })).map((entry) => entry.path)).toContain(
          RelativePath.make(`code/emptydir${path.sep}`),
        )
        if (Protected.names().has("Documents"))
          expect((yield* search.find({ query: "Documents", type: "directory" })).map((entry) => entry.path)).toEqual([])
      }).pipe(Effect.provide(layer))
    })
  })

  it.live("keeps the scan alive when a directory listing fails", () =>
    Effect.gen(function* () {
      const directory = path.join(os.tmpdir(), "opencode-search-unreadable")
      const driver = Environment.makeMemoryDriver()
      const files = Environment.makeFiles(driver)
      const layer = AppNodeBuilder.build(FileSystemSearch.configured({ fff: false }), [
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
        Ripgrep.node.replace(ripgrepStub("src/index.ts", () => {})),
        Environment.node.replace(
          Layer.succeed(
            Environment.Service,
            Environment.Service.of({
              files: {
                ...files,
                // One empty candidate child next to an unknown one: the parent is content, so neither
                // the parent nor the empty child may be published.
                list: (target) => {
                  if (target === directory) return Effect.succeed([{ name: "candidate", type: "directory" as const }])
                  if (target === path.join(directory, "candidate"))
                    return Effect.succeed([
                      { name: "empty", type: "directory" as const },
                      { name: "unreadable", type: "directory" as const },
                    ])
                  if (target === path.join(directory, "candidate", "empty")) return Effect.succeed([])
                  return Effect.fail(new Environment.Failed({ path: target, cause: undefined }))
                },
              },
              spawner: driver.spawner,
            }),
          ),
        ),
      ])

      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        expect((yield* search.find({ query: "index", type: "file" })).map((entry) => entry.path)).toEqual([
          RelativePath.make("src/index.ts"),
        ])
        expect(
          (yield* search.find({ query: "candidate", type: "directory" })).map((entry) => entry.path),
        ).not.toContain(RelativePath.make(`candidate/empty${path.sep}`))
        expect(
          (yield* search.find({ query: "candidate", type: "directory" })).map((entry) => entry.path),
        ).not.toContain(RelativePath.make(`candidate${path.sep}`))
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("finds empty directories in non-git locations without ignore filtering", () =>
    Effect.gen(function* () {
      const directory = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-search-nongit-")))).path
      yield* Effect.promise(() => mkdir(path.join(directory, "emptydir")))
      const layer = AppNodeBuilder.build(FileSystemSearch.configured({ fff: false }), [
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
        Ripgrep.node.replace(ripgrepStub("src/index.ts", () => {})),
      ])

      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        expect((yield* search.find({ query: "emptydir", type: "directory" })).map((entry) => entry.path)).toContain(
          RelativePath.make(`emptydir${path.sep}`),
        )
      }).pipe(Effect.provide(layer))
    }),
  )

  it.live("does not publish discovered directories when ignore rules cannot be evaluated", () =>
    Effect.gen(function* () {
      const directory = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-search-ignore-")))).path
      yield* Effect.promise(() => mkdir(path.join(directory, "emptydir")))
      const driver = Environment.makeMemoryDriver()
      // Real host files with the memory driver's spawner, which always fails to spawn git.
      const local = Environment.makeLocalDriver(driver.spawner)
      const layer = AppNodeBuilder.build(FileSystemSearch.configured({ fff: false }), [
        Location.node.replace(
          Layer.succeed(
            Location.Service,
            Location.Service.of(
              location(
                { directory: AbsolutePath.make(directory) },
                { vcs: { type: "git", store: AbsolutePath.make(path.join(directory, ".git")) } },
              ),
            ),
          ),
        ),
        Ripgrep.node.replace(ripgrepStub("src/index.ts", () => {})),
        Environment.node.replace(
          Layer.succeed(
            Environment.Service,
            Environment.Service.of({ files: Environment.makeFiles(local), spawner: local.spawner }),
          ),
        ),
      ])

      yield* Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        expect((yield* search.find({ query: "index", type: "file" })).map((entry) => entry.path)).toEqual([
          RelativePath.make("src/index.ts"),
        ])
        expect((yield* search.find({ query: "emptydir", type: "directory" })).map((entry) => entry.path)).toEqual([])
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
