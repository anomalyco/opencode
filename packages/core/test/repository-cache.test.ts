import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Git } from "@opencode-ai/core/git"
import { Global } from "@opencode-ai/core/global"
import { Repository } from "@opencode-ai/core/repository"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { git, gitRemote } from "./fixture/git"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

describe("RepositoryCache", () => {
  it.live("replaces a stale cache directory before cloning", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const localPath = Repository.cachePath(path.join(fixture.root, "repos"), fixture.reference)
        yield* Effect.promise(async () => {
          await fs.mkdir(localPath, { recursive: true })
          await fs.writeFile(path.join(localPath, "stale.txt"), "stale")
        })

        const result = yield* (yield* RepositoryCache.Service).ensure({ reference: fixture.reference })

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
        const initial = yield* cache.ensure({ reference: fixture.reference })
        yield* Effect.promise(async () => {
          await git(initial.localPath, "config", "remote.origin.url", "https://github.com/other/repo.git")
          await fs.writeFile(path.join(initial.localPath, "stale.txt"), "stale")
        })

        const replaced = yield* cache.ensure({ reference: fixture.reference })

        expect(replaced.status).toBe("cloned")
        expect(yield* exists(path.join(replaced.localPath, "stale.txt"))).toBe(false)
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("returns typed validation and clone failures", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const cache = yield* RepositoryCache.Service
        const invalidRepository = yield* Effect.flip(RepositoryCache.parseRemote("not-a-repo"))
        expect(invalidRepository).toBeInstanceOf(RepositoryCache.InvalidRepositoryError)

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
  const dependencies = Layer.mergeAll(
    Global.layerWith({ state: path.join(root, "state"), repos: path.join(root, "repos") }),
    FSUtil.defaultLayer,
  )
  return RepositoryCache.layer.pipe(
    Layer.provide(EffectFlock.layer.pipe(Layer.provide(dependencies))),
    Layer.provide(Git.defaultLayer),
    Layer.provide(dependencies),
  )
}

function withRemote<A, E, R>(body: (fixture: Awaited<ReturnType<typeof gitRemote>>) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.promise(async () => {
      const root = await tmpdir()
      return { root, fixture: await gitRemote(root.path) }
    }),
    (input) => body(input.fixture),
    (input) => Effect.promise(() => input.root[Symbol.asyncDispose]()),
  )
}

function read(file: string) {
  return Effect.promise(() => fs.readFile(file, "utf8")).pipe(Effect.map((content) => content.replace(/\r\n/g, "\n")))
}

function exists(file: string) {
  return Effect.promise(() =>
    fs.stat(file).then(
      () => true,
      () => false,
    ),
  )
}
