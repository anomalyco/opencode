import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Layer, Scope } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Bus } from "@opencode-ai/core/bus"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { State } from "@opencode-ai/core/state"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { Reference } from "@opencode-ai/core/reference"
import { Repository } from "@opencode-ai/core/repository"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { it } from "./lib/effect"

const cache = Layer.mock(RepositoryCache.Service, {
  ensure: () => Effect.die("unexpected Git materialization"),
})
const referenceLayer = AppNodeBuilder.build(LayerNode.group([Reference.node, Bus.node]), [
  RepositoryCache.node.replace(cache),
])

describe("Reference", () => {
  it.effect("reads the current editor source by name", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const source = Reference.LocalSource.make({ type: "local", path: AbsolutePath.make("/docs") })
      yield* references.transform((editor) => editor.add("docs", source))
      yield* references.transform((editor) => {
        expect(editor.get("docs")).toBe(editor.list()[0]?.[1])
        expect(editor.get("docs")).toEqual(source)
        expect(editor.get("missing")).toBeUndefined()
        const replacement = Reference.GitSource.make({ type: "git", repository: "owner/repo" })
        editor.add("docs", replacement)
        expect(editor.get("docs")).toBe(replacement)
        editor.remove("docs")
        expect(editor.get("docs")).toBeUndefined()
      })

      expect(yield* references.list()).toEqual([])
    }).pipe(Effect.provide(referenceLayer)),
  )

  it.effect("reads batched references before cache work and update events", () => {
    const operations: RepositoryCache.EnsureInput[] = []
    const started = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    const cache = Layer.succeed(RepositoryCache.Service, {
      ensure: (input) =>
        Effect.gen(function* () {
          operations.push(input)
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
          return {
            repository: input.reference.label,
            host: input.reference.host,
            remote: input.reference.remote,
            localPath: Repository.cachePath(Global.Path.repos, input.reference, input.branch),
            status: "cached",
          } satisfies RepositoryCache.Result
        }),
    })
    const referenceLayer = AppNodeBuilder.build(LayerNode.group([Reference.node, Bus.node]), [
      RepositoryCache.node.replace(cache),
    ])

    return Effect.gen(function* () {
      const references = yield* Reference.Service
      const bus = yield* Bus.Service
      const observed: string[][] = []
      yield* Effect.acquireRelease(
        bus.listen((event) =>
          event.type === Reference.Event.Updated.type
            ? references.list().pipe(
                Effect.map((infos) => {
                  observed.push(infos.map((info) => info.name))
                }),
              )
            : Effect.void,
        ),
        (unsubscribe) => unsubscribe,
      )

      yield* State.batch(
        Effect.gen(function* () {
          yield* references.transform((editor) =>
            editor.add("docs", Reference.LocalSource.make({ type: "local", path: AbsolutePath.make("/docs") })),
          )
          expect((yield* references.list()).map((info) => info.name)).toEqual(["docs"])

          yield* references.transform((editor) => {
            editor.add(
              "sdk",
              Reference.GitSource.make({
                type: "git",
                repository: "owner/repo",
                branch: "feature/docs",
                description: "SDK documentation",
                hidden: true,
              }),
            )
            editor.add("invalid", Reference.GitSource.make({ type: "git", repository: "invalid" }))
            editor.add(
              "invalid-branch",
              Reference.GitSource.make({ type: "git", repository: "owner/repo", branch: "../escape" }),
            )
            editor.add("file", Reference.GitSource.make({ type: "git", repository: "file:///docs" }))
          })
          const infos = yield* references.list()
          expect(infos.map((info) => info.name)).toEqual(["docs", "sdk"])
          expect(infos[1]).toMatchObject({
            path: Repository.cachePath(Global.Path.repos, Repository.parseRemote("owner/repo"), "feature/docs"),
            description: "SDK documentation",
            hidden: true,
          })
          yield* Effect.yieldNow
          expect(operations).toEqual([])
          expect(observed).toEqual([])
        }),
      )

      expect(observed).toEqual([["docs", "sdk"]])
      yield* Deferred.await(started)
      expect(operations).toEqual([
        { reference: Repository.parseRemote("owner/repo"), branch: "feature/docs", refresh: "daily" },
      ])
      expect((yield* references.list()).map((info) => info.name)).toEqual(["docs", "sdk"])
      yield* Effect.yieldNow
      expect(operations).toHaveLength(1)
      expect(observed).toHaveLength(1)
      yield* Deferred.succeed(release, undefined)
    }).pipe(Effect.scoped, Effect.provide(referenceLayer))
  })

  it.effect("lets update listeners replace references and refetch current info", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const bus = yield* Bus.Service
      const scope = yield* Scope.Scope
      const observed: string[][] = []
      let reentered = false
      const first = yield* bus.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== Reference.Event.Updated.type || reentered) return
          reentered = true
          yield* references
            .transform((editor) =>
              editor.add("docs", Reference.LocalSource.make({ type: "local", path: AbsolutePath.make("/new") })),
            )
            .pipe(Scope.provide(scope))
        }),
      )
      const second = yield* bus.listen((event) =>
        event.type === Reference.Event.Updated.type
          ? references.list().pipe(
              Effect.map((infos) => {
                observed.push(infos.map((info) => info.path))
              }),
            )
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => first.pipe(Effect.andThen(second)))

      yield* references.transform((editor) =>
        editor.add("docs", Reference.LocalSource.make({ type: "local", path: AbsolutePath.make("/old") })),
      )

      expect((yield* references.list()).map((info) => info.path)).toEqual([AbsolutePath.make("/new")])
      expect(observed).toEqual([["/new"], ["/new"]])
    }).pipe(Effect.scoped, Effect.provide(referenceLayer)),
  )

  it.effect("registers normalized sources for the owning scope", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const scope = yield* Scope.make()
      const path = AbsolutePath.make("/docs")
      const source = Reference.LocalSource.make({
        type: "local",
        path,
        description: "Use for API documentation",
        hidden: true,
      })
      yield* references.transform((editor) => editor.add("docs", source)).pipe(Scope.provide(scope))

      expect(yield* references.list()).toEqual([
        Reference.Info.make({ name: "docs", path, description: "Use for API documentation", hidden: true, source }),
      ])

      yield* Scope.close(scope, Exit.void)
      expect(yield* references.list()).toEqual([])
    }).pipe(Effect.provide(referenceLayer)),
  )

  it.effect("derives Git paths without exposing cache operations", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const repository = Repository.parseRemote("owner/repo")
      const source = Reference.GitSource.make({ type: "git", repository: "owner/repo", branch: "main" })
      yield* references.transform((editor) => editor.add("sdk", source))

      expect(yield* references.list()).toEqual([
        Reference.Info.make({
          name: "sdk",
          path: AbsolutePath.make(Repository.cachePath(Global.Path.repos, repository, "main")),
          source,
        }),
      ])
    }).pipe(Effect.scoped, Effect.provide(referenceLayer)),
  )

  it.effect("preserves configured Git descriptions", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const repository = Repository.parseRemote("owner/repo")
      const source = Reference.GitSource.make({
        type: "git",
        repository: "owner/repo",
        description: "Use for SDK implementation details",
      })
      yield* references.transform((editor) => editor.add("sdk", source))

      expect(yield* references.list()).toEqual([
        Reference.Info.make({
          name: "sdk",
          path: AbsolutePath.make(Repository.cachePath(Global.Path.repos, repository)),
          description: "Use for SDK implementation details",
          source,
        }),
      ])
    }).pipe(Effect.scoped, Effect.provide(referenceLayer)),
  )
})
