import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { Duration, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Git } from "@opencode-ai/core/git"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/util/global"
import { Repository } from "@opencode-ai/core/repository"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { branch, commit, git, gitRemote } from "./fixture/git"
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

  it.live("keeps branch checkouts isolated from branchless refreshes", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => branch(fixture.source, "feature", "two\n"))
        const cache = yield* RepositoryCache.Service

        const featured = yield* cache.ensure({ reference: fixture.reference, branch: "feature" })
        expect(featured.branch).toBe("feature")
        expect(featured.localPath.endsWith("repo@feature")).toBe(true)
        expect(yield* read(path.join(featured.localPath, "README.md"))).toBe("two\n")

        const refreshed = yield* cache.ensure({ reference: fixture.reference })
        expect(refreshed.localPath).not.toBe(featured.localPath)
        expect(yield* read(path.join(refreshed.localPath, "README.md"))).toBe("one\n")

        const cached = yield* cache.ensure({ reference: fixture.reference, branch: "feature" })
        expect(cached.status).toBe("cached")
        expect(yield* read(path.join(cached.localPath, "README.md"))).toBe("two\n")
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("does not refresh a checkout with fresh metadata", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const cache = yield* RepositoryCache.Service
        const initial = yield* cache.ensure({ reference: fixture.reference })
        yield* Effect.promise(() => commit(fixture.source, "two\n", "second"))

        const cached = yield* cache.ensure({ reference: fixture.reference })

        expect(cached.status).toBe("cached")
        expect(yield* read(path.join(initial.localPath, "README.md"))).toBe("one\n")
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("refreshes an expired checkout from origin", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const cache = yield* RepositoryCache.Service
        const initial = yield* cache.ensure({ reference: fixture.reference })
        yield* Effect.promise(() => commit(fixture.source, "two\n", "second"))
        yield* Effect.promise(async () => {
          await git(initial.localPath, "remote", "add", "other", path.join(fixture.root, "missing.git"))
          await fs.writeFile(refreshAttemptFile(initial.localPath), "0")
        })

        const refreshed = yield* cache.ensure({ reference: fixture.reference })

        expect(refreshed.status).toBe("refreshed")
        expect(yield* read(path.join(initial.localPath, "README.md"))).toBe("two\n")
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("uses the configured refresh interval", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const cache = yield* RepositoryCache.Service
        const initial = yield* cache.ensure({ reference: fixture.reference })
        yield* Effect.promise(() => commit(fixture.source, "two\n", "second"))
        yield* Effect.promise(() => fs.writeFile(refreshAttemptFile(initial.localPath), String(Date.now() - 120_000)))

        const refreshed = yield* cache.ensure({ reference: fixture.reference, refresh: Duration.minutes(1) })
        expect(refreshed.status).toBe("refreshed")
        expect(yield* read(path.join(initial.localPath, "README.md"))).toBe("two\n")

        yield* Effect.promise(() => commit(fixture.source, "three\n", "third"))
        const cached = yield* cache.ensure({ reference: fixture.reference, refresh: Duration.hours(1) })
        expect(cached.status).toBe("cached")
        expect(yield* read(path.join(initial.localPath, "README.md"))).toBe("two\n")
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("clones and refreshes SSH remotes with the standard cache policy", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => {
        const root = await tmpdir()
        return { root, ...sshCache(root.path) }
      }),
      (fixture) =>
        Effect.gen(function* () {
          const cache = yield* RepositoryCache.Service
          expect(fixture.reference.remote).toBe("ssh://git@github.com/owner/repo.git")
          const cloned = yield* cache.ensure({ reference: fixture.reference })
          yield* Effect.promise(() => fs.writeFile(refreshAttemptFile(fixture.localPath), "0"))

          const refreshed = yield* cache.ensure({ reference: fixture.reference })

          expect(cloned.status).toBe("cloned")
          expect(refreshed.status).toBe("refreshed")
          expect(fixture.cloneRemotes).toEqual([fixture.reference.remote])
          expect(fixture.fetchRemotes).toEqual([fixture.reference.remote])
        }).pipe(Effect.provide(fixture.layer)),
      (fixture) => Effect.promise(() => fixture.root[Symbol.asyncDispose]()),
    ),
  )

  it.live("preserves a checkout and rate limits failed refreshes", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const cache = yield* RepositoryCache.Service
        const initial = yield* cache.ensure({ reference: fixture.reference })
        const remote = pathToFileURL(path.join(fixture.root, "missing.git")).href
        yield* Effect.promise(async () => {
          await git(initial.localPath, "config", "remote.origin.url", remote)
          await fs.writeFile(refreshAttemptFile(initial.localPath), "0")
        })

        const error = yield* Effect.flip(cache.ensure({ reference: { ...fixture.reference, remote } }))
        const cached = yield* cache.ensure({ reference: { ...fixture.reference, remote } })

        expect(error).toBeInstanceOf(RepositoryCache.FetchFailedError)
        expect(cached.status).toBe("cached")
        expect(yield* read(path.join(initial.localPath, "README.md"))).toBe("one\n")
      }).pipe(Effect.provide(cacheLayer(fixture.root))),
    ),
  )

  it.live("does not mistake an enclosing repository for the cache checkout", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => git(fixture.root, "clone", fixture.remote, path.join(fixture.root, "repos")))

        const result = yield* (yield* RepositoryCache.Service).ensure({ reference: fixture.reference })

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
  return AppNodeBuilder.build(RepositoryCache.node, [
    [Global.node, Global.layerWith({ state: path.join(root, "state"), repos: path.join(root, "repos") })],
  ])
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

function refreshAttemptFile(checkout: string) {
  return path.join(checkout, ".git", "opencode-reference-refresh-attempt")
}

function sshCache(root: string) {
  const reference = Repository.parseRemote("ssh://git@github.com/owner/repo.git")
  const localPath = Repository.cachePath(path.join(root, "repos"), reference)
  const state: {
    checkout?: Git.Repository
    cloneRemotes: string[]
    fetchRemotes: string[]
  } = {
    checkout: undefined,
    cloneRemotes: [],
    fetchRemotes: [],
  }
  const layer = AppNodeBuilder.build(RepositoryCache.node, [
    [Global.node, Global.layerWith({ state: path.join(root, "state"), repos: path.join(root, "repos") })],
    [
      Git.node,
      Layer.mock(Git.Service, {
        repo: {
          discover: () => Effect.succeed(state.checkout),
          clone: (input) =>
            Effect.promise(async () => {
              expect(input.nonInteractive).toBe(true)
              state.cloneRemotes.push(input.remote)
              const checkout = new Git.Repository({
                worktree: input.directory,
                gitDirectory: AbsolutePath.make(path.join(input.directory, ".git")),
                commonDirectory: AbsolutePath.make(path.join(input.directory, ".git")),
              })
              await fs.mkdir(checkout.gitDirectory, { recursive: true })
              state.checkout = checkout
              return checkout
            }),
          create: () => Effect.die("Unexpected repository creation"),
        },
        remote: { get: () => Effect.succeed(reference.remote) },
        history: {
          head: () => Effect.succeed("head"),
          branch: () => Effect.succeed("main"),
          defaultRemoteBranch: () => Effect.succeed("main"),
          rootCommits: () => Effect.succeed([]),
        },
        sync: {
          fetchRemotes: () => Effect.die("Unexpected fetch all"),
          fetchOrigin: (_, input) => Effect.sync(() => {
            expect(input?.nonInteractive).toBe(true)
            state.fetchRemotes.push(reference.remote)
          }),
          fetchBranch: () => Effect.die("Unexpected branch fetch"),
          checkoutRemoteBranch: () => Effect.void,
          resetHard: () => Effect.void,
        },
        worktree: {
          create: () => Effect.die("Unexpected worktree creation"),
          remove: () => Effect.die("Unexpected worktree removal"),
          list: () => Effect.die("Unexpected worktree listing"),
        },
        index: {
          refresh: () => Effect.die("Unexpected index refresh"),
          ignored: () => Effect.die("Unexpected index lookup"),
        },
        tree: {
          capture: () => Effect.die("Unexpected tree capture"),
          write: () => Effect.die("Unexpected tree write"),
          files: () => Effect.die("Unexpected tree file listing"),
          diff: () => Effect.die("Unexpected tree diff"),
          restore: () => Effect.die("Unexpected tree restore"),
        },
      }),
    ],
  ])

  return { reference, localPath, layer, cloneRemotes: state.cloneRemotes, fetchRemotes: state.fetchRemotes }
}
