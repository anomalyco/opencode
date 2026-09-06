import { describe, expect, setDefaultTimeout } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { Clock, Duration, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/util/global"
import { Repository } from "@opencode-ai/core/repository"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { Database } from "@opencode-ai/core/database/database"
import { KV } from "@opencode-ai/core/kv"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { branch, commit, git, read, withRemote } from "./fixture/git"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

// Cold Git setup and cloning can exceed Bun's five-second default on Windows.
setDefaultTimeout(15_000)

describe("RepositoryCache", () => {
  it.live("persists the daily throttle across cache recreation and serializes competing refreshes", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const initial = yield* Effect.gen(function* () {
          const cache = yield* RepositoryCache.Service
          return yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })
        }).pipe(Effect.provide(cacheLayer(fixture.root)))
        expect(initial.status).toBe("cloned")
        yield* Effect.promise(() => commit(fixture.source, "two\n", "advance main"))

        yield* Effect.gen(function* () {
          const cache = yield* RepositoryCache.Service
          const kv = yield* KV.Service
          expect((yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })).status).toBe("cached")
          expect(yield* read(path.join(initial.localPath, "README.md"))).toBe("one\n")
          const yesterday = (yield* Clock.currentTimeMillis) - Duration.toMillis(Duration.days(1))
          yield* kv.set(`repository-cache:${initial.localPath}`, { attemptedAt: yesterday })
        }).pipe(Effect.provide(cacheLayer(fixture.root)))

        const results = yield* Effect.all(
          [0, 1].map(() =>
            Effect.gen(function* () {
              const cache = yield* RepositoryCache.Service
              return yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })
            }).pipe(Effect.provide(cacheLayer(fixture.root))),
          ),
          { concurrency: "unbounded" },
        )
        expect(results.map((result) => result.status).toSorted()).toEqual(["cached", "refreshed"])
        expect(yield* read(path.join(initial.localPath, "README.md"))).toBe("two\n")

        // A missing checkout must be recreated even when the persisted timestamp is recent.
        yield* Effect.promise(() => fs.rm(initial.localPath, { recursive: true }))
        yield* Effect.gen(function* () {
          const cache = yield* RepositoryCache.Service
          expect((yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })).status).toBe("cloned")
        }).pipe(Effect.provide(cacheLayer(fixture.root)))
        expect(yield* read(path.join(initial.localPath, "README.md"))).toBe("two\n")
      }),
    ),
  )

  it.live("honors legacy attempt records while allowing forced refreshes", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const cache = yield* RepositoryCache.Service
        const kv = yield* KV.Service
        const initial = yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })
        yield* Effect.promise(() => commit(fixture.source, "two\n", "advance main"))

        // Persisted records from older versions include an unused success timestamp.
        yield* kv.set(`repository-cache:${initial.localPath}`, {
          attemptedAt: yield* Clock.currentTimeMillis,
          refreshedAt: 0,
        })
        expect((yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })).status).toBe("cached")
        expect(yield* read(path.join(initial.localPath, "README.md"))).toBe("one\n")

        expect((yield* cache.ensure({ reference: fixture.reference, refresh: true })).status).toBe("refreshed")
        expect(yield* read(path.join(initial.localPath, "README.md"))).toBe("two\n")
        expect((yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })).status).toBe("cached")
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("throttles failed refresh attempts until the next interval", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const cache = yield* RepositoryCache.Service
        const kv = yield* KV.Service
        const initial = yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })
        const key = `repository-cache:${initial.localPath}`
        const yesterday = (yield* Clock.currentTimeMillis) - Duration.toMillis(Duration.days(1))
        yield* kv.set(key, { attemptedAt: yesterday })
        yield* Effect.promise(() =>
          fs.rename(path.join(fixture.root, "origin.git"), path.join(fixture.root, "offline.git")),
        )

        const error = yield* Effect.flip(cache.ensure({ reference: fixture.reference, refresh: "daily" }))
        expect(error).toBeInstanceOf(RepositoryCache.FetchFailedError)
        expect((yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })).status).toBe("cached")
        expect(yield* read(path.join(initial.localPath, "README.md"))).toBe("one\n")

        yield* Effect.promise(async () => {
          await fs.rename(path.join(fixture.root, "offline.git"), path.join(fixture.root, "origin.git"))
          await commit(fixture.source, "two\n", "advance main")
        })
        yield* kv.set(key, { attemptedAt: yesterday })
        expect((yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })).status).toBe("refreshed")
        expect(yield* read(path.join(initial.localPath, "README.md"))).toBe("two\n")
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("refreshes existing untracked checkouts and keeps branch freshness independent", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const cache = yield* RepositoryCache.Service
        const kv = yield* KV.Service
        yield* Effect.promise(() => branch(fixture.source, "feature", "feature\n"))
        const main = yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })
        const feature = yield* cache.ensure({ reference: fixture.reference, branch: "feature", refresh: "daily" })
        yield* kv.remove(`repository-cache:${feature.localPath}`)
        yield* Effect.promise(() => commit(fixture.source, "new feature\n", "advance feature"))

        expect((yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })).status).toBe("cached")
        expect(
          (yield* cache.ensure({ reference: fixture.reference, branch: "feature", refresh: "daily" })).status,
        ).toBe("refreshed")
        expect(yield* read(path.join(main.localPath, "README.md"))).toBe("one\n")
        expect(yield* read(path.join(feature.localPath, "README.md"))).toBe("new feature\n")
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("replaces a stale cache directory before cloning", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const localPath = Repository.cachePath(path.join(fixture.root, "repos"), fixture.reference)
        yield* Effect.promise(async () => {
          await fs.mkdir(localPath, { recursive: true })
          await fs.writeFile(path.join(localPath, "stale.txt"), "stale")
        })

        const cache = yield* RepositoryCache.Service
        const result = yield* cache.ensure({ reference: fixture.reference })

        expect(result.status).toBe("cloned")
        expect(yield* exists(path.join(localPath, "stale.txt"))).toBe(false)
        expect(yield* read(path.join(localPath, "README.md"))).toBe("one\n")
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("serializes concurrent materialization for the same checkout", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const cache = yield* RepositoryCache.Service
        const results = yield* Effect.all(
          [cache.ensure({ reference: fixture.reference }), cache.ensure({ reference: fixture.reference })],
          { concurrency: "unbounded" },
        )

        expect(results.map((result) => result.status).toSorted()).toEqual(["cached", "cloned"])
        expect(results[0].localPath).toBe(results[1].localPath)
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("replaces an existing checkout whose origin does not match", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const cache = yield* RepositoryCache.Service
        const initial = yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })
        yield* Effect.promise(async () => {
          await git(initial.localPath, "config", "remote.origin.url", "https://github.com/other/repo.git")
          await fs.writeFile(path.join(initial.localPath, "stale.txt"), "stale")
        })

        const replaced = yield* cache.ensure({ reference: fixture.reference, refresh: "daily" })

        expect(replaced.status).toBe("cloned")
        expect(yield* exists(path.join(replaced.localPath, "stale.txt"))).toBe(false)
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("keeps branch checkouts isolated from branchless refreshes", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => branch(fixture.source, "feature", "two\n"))
        const cache = yield* RepositoryCache.Service

        const featured = yield* cache.ensure({ reference: fixture.reference, branch: "feature" })
        expect(featured.branch).toBe("feature")
        expect(featured.localPath.endsWith("repo@feature")).toBe(true)
        expect(yield* read(path.join(featured.localPath, "README.md"))).toBe("two\n")

        const refreshed = yield* cache.ensure({ reference: fixture.reference, refresh: true })
        expect(refreshed.localPath).not.toBe(featured.localPath)
        expect(yield* read(path.join(refreshed.localPath, "README.md"))).toBe("one\n")

        const cached = yield* cache.ensure({ reference: fixture.reference, branch: "feature" })
        expect(cached.status).toBe("cached")
        expect(yield* read(path.join(cached.localPath, "README.md"))).toBe("two\n")
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("does not mistake an enclosing repository for the cache checkout", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => git(fixture.root, "clone", fixture.remote, path.join(fixture.root, "repos")))

        const cache = yield* RepositoryCache.Service
        const result = yield* cache.ensure({ reference: fixture.reference })

        expect(result.status).toBe("cloned")
        expect(yield* read(path.join(result.localPath, "README.md"))).toBe("one\n")
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("returns typed branch validation and clone failures", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const cache = yield* RepositoryCache.Service
        const invalidBranch = yield* Effect.flip(cache.ensure({ reference: fixture.reference, branch: "../unsafe" }))
        expect(invalidBranch).toBeInstanceOf(RepositoryCache.InvalidBranchError)

        const cloneFailure = yield* Effect.flip(
          cache.ensure({
            reference: { ...fixture.reference, remote: pathToFileURL(path.join(fixture.root, "missing.git")).href },
          }),
        )
        expect(cloneFailure).toBeInstanceOf(RepositoryCache.CloneFailedError)
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )
})

function cacheLayer(root: string) {
  return AppNodeBuilder.build(LayerNode.group([RepositoryCache.node, KV.node]), [
    Global.node.replace(Global.layerWith({ state: path.join(root, "state"), repos: path.join(root, "repos") })),
    Database.node.replace(Database.configured({ path: path.join(root, "cache.sqlite") })),
  ])
}

function exists(file: string) {
  return Effect.promise(() =>
    fs.stat(file).then(
      () => true,
      () => false,
    ),
  )
}
