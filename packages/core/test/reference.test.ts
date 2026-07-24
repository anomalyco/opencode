import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Exit, Layer, Scope } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { Reference } from "@opencode-ai/core/reference"
import { Repository } from "@opencode-ai/core/repository"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const cacheMock = (
  ensure: (input: RepositoryCache.EnsureInput) => Effect.Effect<RepositoryCache.Result, RepositoryCache.Error>,
) => Layer.mock(RepositoryCache.Service, { ensure, prune: Effect.void })

const materialize = (input: RepositoryCache.EnsureInput): RepositoryCache.Result => ({
  repository: input.reference.label,
  host: input.reference.host,
  remote: input.reference.remote,
  localPath: "unused",
  status: "cloned",
})

const unavailable = () =>
  Effect.fail(new RepositoryCache.CloneFailedError({ repository: "owner/repo", message: "unavailable" }))

const layerFor = (root: string, cache: Layer.Layer<RepositoryCache.Service>) =>
  AppNodeBuilder.build(Reference.node, [
    [RepositoryCache.node, cache],
    [Global.node, Global.layerWith({ state: path.join(root, "state"), repos: path.join(root, "repos") })],
  ])

function withRoot<A, E, R>(body: (root: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => body(tmp.path),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )
}

/** Yields until forked materializations have had a chance to complete. */
const eventually = <A>(effect: Effect.Effect<A>, done: (value: A) => boolean) =>
  Effect.gen(function* () {
    for (let index = 0; index < 200; index++) {
      const value = yield* effect
      if (done(value)) return value
      yield* Effect.yieldNow
    }
    return yield* effect
  })

describe("Reference", () => {
  it.effect("registers normalized sources for the owning scope", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const scope = yield* Scope.make()
      const target = AbsolutePath.make("/docs")
      const source = Reference.LocalSource.make({
        type: "local",
        path: target,
        description: "Use for API documentation",
        hidden: true,
      })
      yield* references.transform((editor) => editor.add("docs", source)).pipe(Scope.provide(scope))

      expect(yield* references.list()).toEqual([
        Reference.Info.make({
          name: "docs",
          path: target,
          description: "Use for API documentation",
          hidden: true,
          source,
        }),
      ])

      yield* Scope.close(scope, Exit.void)
      expect(yield* references.list()).toEqual([])
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(Reference.node, [
          [RepositoryCache.node, cacheMock(() => Effect.die("unexpected Git materialization"))],
        ]),
      ),
    ),
  )

  it.effect("announces Git references once materialization succeeds", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const references = yield* Reference.Service
        const repository = Repository.parseRemote("owner/repo")
        const source = Reference.GitSource.make({ type: "git", repository: "owner/repo", branch: "main" })
        yield* references.transform((editor) => editor.add("sdk", source))

        expect(yield* eventually(references.list(), (infos) => infos.length > 0)).toEqual([
          Reference.Info.make({
            name: "sdk",
            path: AbsolutePath.make(Repository.cachePath(path.join(root, "repos"), repository, "main")),
            source,
          }),
        ])
      }).pipe(Effect.provide(layerFor(root, cacheMock((input) => Effect.succeed(materialize(input)))))),
    ),
  )

  it.effect("preserves configured Git descriptions", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const references = yield* Reference.Service
        const repository = Repository.parseRemote("owner/repo")
        const source = Reference.GitSource.make({
          type: "git",
          repository: "owner/repo",
          description: "Use for SDK implementation details",
        })
        yield* references.transform((editor) => editor.add("sdk", source))

        expect(yield* eventually(references.list(), (infos) => infos.length > 0)).toEqual([
          Reference.Info.make({
            name: "sdk",
            path: AbsolutePath.make(Repository.cachePath(path.join(root, "repos"), repository)),
            description: "Use for SDK implementation details",
            source,
          }),
        ])
      }).pipe(Effect.provide(layerFor(root, cacheMock((input) => Effect.succeed(materialize(input)))))),
    ),
  )

  it.effect("keeps references hidden while materialization fails", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const references = yield* Reference.Service
        const source = Reference.GitSource.make({ type: "git", repository: "owner/repo" })
        yield* references.transform((editor) => editor.add("sdk", source))

        for (let index = 0; index < 20; index++) yield* Effect.yieldNow
        expect(yield* references.list()).toEqual([])
      }).pipe(Effect.provide(layerFor(root, cacheMock(unavailable)))),
    ),
  )

  it.effect("serves checkouts already on disk before refresh completes", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const repository = Repository.parseRemote("owner/repo")
        const target = Repository.cachePath(path.join(root, "repos"), repository)
        yield* Effect.promise(() => fs.mkdir(target, { recursive: true }))

        const references = yield* Reference.Service
        const source = Reference.GitSource.make({ type: "git", repository: "owner/repo" })
        yield* references.transform((editor) => editor.add("sdk", source))

        expect(yield* references.list()).toEqual([
          Reference.Info.make({ name: "sdk", path: AbsolutePath.make(target), source }),
        ])
      }).pipe(Effect.provide(layerFor(root, cacheMock(unavailable)))),
    ),
  )
})
