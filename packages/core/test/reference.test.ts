import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Scope } from "effect"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { Reference } from "@opencode-ai/core/reference"
import { Repository } from "@opencode-ai/core/repository"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { SshCache } from "@opencode-ai/core/ssh-cache"
import { EventV2 } from "@opencode-ai/core/event"
import { it } from "./lib/effect"

const cache = Layer.mock(RepositoryCache.Service, {
  ensure: () => Effect.die("unexpected Git materialization"),
})

const sshCache = Layer.mock(SshCache.Service, {
  ensure: () => Effect.die("unexpected SSH materialization"),
})

describe("Reference", () => {
  it.effect("registers normalized sources for the owning scope", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const scope = yield* Scope.make()
      const update = yield* references.transform().pipe(Effect.provideService(Scope.Scope, scope))
      const path = AbsolutePath.make("/docs")
      const source = new Reference.LocalSource({
        type: "local",
        path,
        description: "Use for API documentation",
        hidden: true,
      })
      yield* update((editor) => editor.add("docs", source))

      expect(yield* references.list()).toEqual([
        new Reference.Info({ name: "docs", path, description: "Use for API documentation", hidden: true, source }),
      ])

      yield* Scope.close(scope, Exit.void)
      expect(yield* references.list()).toEqual([])
    }).pipe(
      Effect.provide(Reference.layer),
      Effect.provide(cache),
      Effect.provide(sshCache),
      Effect.provide(EventV2.defaultLayer),
      Effect.provide(Global.defaultLayer),
    ),
  )

  it.effect("derives Git paths without exposing cache operations", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const update = yield* references.transform()
      const repository = Repository.parseRemote("owner/repo")
      const source = new Reference.GitSource({ type: "git", repository: "owner/repo", branch: "main" })
      yield* update((editor) => editor.add("sdk", source))

      expect(yield* references.list()).toEqual([
        new Reference.Info({
          name: "sdk",
          path: AbsolutePath.make(Repository.cachePath(Global.Path.repos, repository)),
          source,
        }),
      ])
    }).pipe(
      Effect.scoped,
      Effect.provide(Reference.layer),
      Effect.provide(cache),
      Effect.provide(sshCache),
      Effect.provide(EventV2.defaultLayer),
      Effect.provide(Global.defaultLayer),
    ),
  )

  it.effect("preserves configured Git descriptions", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const update = yield* references.transform()
      const repository = Repository.parseRemote("owner/repo")
      const source = new Reference.GitSource({
        type: "git",
        repository: "owner/repo",
        description: "Use for SDK implementation details",
      })
      yield* update((editor) => editor.add("sdk", source))

      expect(yield* references.list()).toEqual([
        new Reference.Info({
          name: "sdk",
          path: AbsolutePath.make(Repository.cachePath(Global.Path.repos, repository)),
          description: "Use for SDK implementation details",
          source,
        }),
      ])
    }).pipe(
      Effect.scoped,
      Effect.provide(Reference.layer),
      Effect.provide(cache),
      Effect.provide(sshCache),
      Effect.provide(EventV2.defaultLayer),
      Effect.provide(Global.defaultLayer),
    ),
  )

  it.effect("derives SSH paths without exposing cache operations", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const update = yield* references.transform()
      const source = new Reference.SshSource({
        type: "ssh",
        host: "example.com",
        remotePath: "/var/www/data",
        user: "deploy",
        description: "Use for deployment data",
      })
      yield* update((editor) => editor.add("data", source))

      const list = yield* references.list()
      expect(list).toHaveLength(1)
      const info = list[0]
      expect(info.name).toBe("data")
      expect(info.description).toBe("Use for deployment data")
      expect(info.source).toEqual(source)
      expect(info.path).toStartWith(Global.Path.sshCache)
      expect(info.path).toMatch(/[0-9a-f]{16}$/)
    }).pipe(
      Effect.scoped,
      Effect.provide(Reference.layer),
      Effect.provide(cache),
      Effect.provide(sshCache),
      Effect.provide(EventV2.defaultLayer),
      Effect.provide(Global.defaultLayer),
    ),
  )

  it.effect("preserves SSH host and remotePath fields", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const update = yield* references.transform()
      const source = new Reference.SshSource({
        type: "ssh",
        host: "build.internal",
        remotePath: "/opt/project",
        port: 2222,
        identityFile: "~/.ssh/build_key",
        hidden: true,
      })
      yield* update((editor) => editor.add("build", source))

      const list = yield* references.list()
      expect(list).toHaveLength(1)
      expect(list[0].source).toEqual(source)
    }).pipe(
      Effect.scoped,
      Effect.provide(Reference.layer),
      Effect.provide(cache),
      Effect.provide(sshCache),
      Effect.provide(EventV2.defaultLayer),
      Effect.provide(Global.defaultLayer),
    ),
  )
})
