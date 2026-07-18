import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Scope } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { Reference } from "@opencode-ai/core/reference"
import { Repository } from "@opencode-ai/core/repository"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { it } from "./lib/effect"

const cache = Layer.mock(RepositoryCache.Service, {
  ensure: () => Effect.die("unexpected Git materialization"),
})
const referenceLayer = AppNodeBuilder.build(Reference.node, [[RepositoryCache.node, cache]])

describe("Reference", () => {
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
        new Reference.Info({ name: "docs", path, description: "Use for API documentation", hidden: true, source }),
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
        new Reference.Info({
          name: "sdk",
          path: AbsolutePath.make(Repository.cachePath(Global.Path.repos, repository)),
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
        new Reference.Info({
          name: "sdk",
          path: AbsolutePath.make(Repository.cachePath(Global.Path.repos, repository)),
          description: "Use for SDK implementation details",
          source,
        }),
      ])
    }).pipe(Effect.scoped, Effect.provide(referenceLayer)),
  )
})
