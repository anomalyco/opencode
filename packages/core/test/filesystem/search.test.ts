import { describe, expect, spyOn, test } from "bun:test"
import fuzzysort from "fuzzysort"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Deferred, Effect, Exit, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Protected } from "@opencode-ai/core/filesystem/protected"
import { FileSystemSearch } from "@opencode-ai/core/filesystem/search"
import { Location } from "@opencode-ai/core/location"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Database } from "@opencode-ai/core/database/database"
import { Bus } from "@opencode-ai/core/bus"
import { Global } from "@opencode-ai/util/global"
import { tempGlobalLayer } from "../fixture/global"
import { tmpdir } from "../fixture/tmpdir"

describe("FileSystemSearch", () => {
  test("shares a ripgrep inventory for one physical scan root", async () => {
    const root = await tmpdir()
    const alias = root.path + "-alias"
    await fs.symlink(root.path, alias, process.platform === "win32" ? "junction" : "dir")
    let scans = 0
    const scanned = Effect.runSync(Deferred.make<void>())
    const release = Effect.runSync(Deferred.make<void>())
    const ripgrep = Layer.succeed(
      Ripgrep.Service,
      Ripgrep.Service.of({
        find: (input) =>
          Effect.gen(function* () {
            scans++
            const entry = FileSystem.Entry.make({ path: RelativePath.make("src/index.ts"), type: "file" })
            yield* Deferred.succeed(scanned, undefined)
            yield* Deferred.await(release)
            if (input.onEntry) yield* input.onEntry(entry)
            return [entry]
          }),
        glob: () => Effect.succeed([]),
        grep: () => Effect.succeed([]),
      }),
    )
    const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, LocationServiceMap.node]), [
      [Global.node, tempGlobalLayer],
      [Ripgrep.node, ripgrep],
    ])

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const locations = yield* LocationServiceMap.Service
          const firstScope = yield* Scope.make()
          const secondScope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(secondScope, Exit.void))
          yield* locations
            .contextEffect(Location.Ref.make({ directory: AbsolutePath.make(root.path) }))
            .pipe(Scope.provide(firstScope))
          yield* Deferred.await(scanned)
          const second = yield* locations
            .contextEffect(Location.Ref.make({ directory: AbsolutePath.make(alias) }))
            .pipe(Scope.provide(secondScope))
          yield* Scope.close(firstScope, Exit.void)
          yield* Deferred.succeed(release, undefined)
          const find = FileSystemSearch.Service.use((search) => search.find({ query: "index", type: "file" })).pipe(
            Effect.provideContext(second),
          )

          expect(yield* find.pipe(Effect.repeat({ until: (entries) => entries.length > 0 }))).toHaveLength(1)
          expect(scans).toBe(1)
        }).pipe(Effect.provide(layer), Effect.scoped),
      )
    } finally {
      await fs.rm(alias, { recursive: true, force: true })
      await root[Symbol.asyncDispose]()
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
    const initial = Effect.runSync(Deferred.make<void>())
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
                if (scans === 1) yield* Deferred.succeed(initial, undefined)
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
        yield* Deferred.await(initial)
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
    const first = Effect.runSync(Deferred.make<void>())
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
                yield* Deferred.succeed(scans === 1 ? first : second, undefined)
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
        yield* Deferred.await(first)
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
