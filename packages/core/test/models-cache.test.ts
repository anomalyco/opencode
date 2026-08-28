import path from "path"
import { expect } from "bun:test"
import { Deferred, Effect, Fiber, FileSystem, Layer } from "effect"
import { ModelsDevCache } from "@opencode-ai/core/models-dev/cache"
import { LayerNodePlatform } from "@opencode-ai/util/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { Hash } from "@opencode-ai/util/hash"
import { tempGlobalLayer } from "./fixture/global"
import { testEffect } from "./lib/effect"

const source = "https://models.opencode.ai"
const it = testEffect(
  LayerNode.compile(LayerNode.group([ModelsDevCache.node, LayerNodePlatform.filesystem, Global.node]), [
    [Global.node, tempGlobalLayer],
  ]),
)

it.live("returns undefined for a missing catalog", () =>
  Effect.gen(function* () {
    const cache = yield* ModelsDevCache.Service
    expect(yield* cache.read(source)).toBeUndefined()
  }),
)

it.live("persists raw catalog bodies larger than 2 MB with the file mtime", () =>
  Effect.gen(function* () {
    const cache = yield* ModelsDevCache.Service
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const body = ` {\n  "payload": "${"x".repeat(2 * 1024 * 1024)}"\n}\n`
    const file = path.join(global.cache, "models-dev", `${Hash.fast(source)}.json`)
    const modified = new Date("2026-01-01T00:00:00Z")

    yield* cache.write(source, body)
    expect(yield* fs.readFileString(file)).toBe(body)
    yield* fs.utimes(file, modified, modified)
    expect(yield* cache.read(source)).toEqual({ body, updatedAt: modified.getTime() })
  }),
)

it.live("isolates catalogs by source including the default source", () =>
  Effect.gen(function* () {
    const cache = yield* ModelsDevCache.Service
    const custom = "https://models.example.com"

    yield* cache.write(source, "default catalog")
    expect(yield* cache.read(custom)).toBeUndefined()
    yield* cache.write(custom, "custom catalog")
    expect((yield* cache.read(source))?.body).toBe("default catalog")
    expect((yield* cache.read(custom))?.body).toBe("custom catalog")
  }),
)

it.live("replaces an existing catalog without leaving temporary files", () =>
  Effect.gen(function* () {
    const cache = yield* ModelsDevCache.Service
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service

    yield* cache.write(source, "old catalog")
    yield* cache.write(source, "new catalog")
    expect((yield* cache.read(source))?.body).toBe("new catalog")
    expect(yield* fs.readDirectory(path.join(global.cache, "models-dev"))).toEqual([`${Hash.fast(source)}.json`])
  }),
)

it.live("cleans up temporary files and preserves platform errors when replacement fails", () =>
  Effect.gen(function* () {
    const cache = yield* ModelsDevCache.Service
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const directory = path.join(global.cache, "models-dev")
    const file = path.join(directory, `${Hash.fast(source)}.json`)
    yield* fs.makeDirectory(file, { recursive: true })

    const error = yield* cache.write(source, "new catalog").pipe(Effect.flip)
    expect(error._tag).toBe("PlatformError")
    expect(yield* fs.readDirectory(directory)).toEqual([`${Hash.fast(source)}.json`])
    expect((yield* fs.stat(file)).type).toBe("Directory")
    expect((yield* cache.read(source).pipe(Effect.flip))._tag).toBe("PlatformError")
  }),
)

it.live("keeps the old catalog readable and cleans up an interrupted replacement", () =>
  Effect.gen(function* () {
    const cache = yield* ModelsDevCache.Service
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const staged = yield* Deferred.make<string>()
    yield* cache.write(source, "old catalog")

    // Pause only the commit; staging and cleanup still use the real filesystem.
    const writer = yield* ModelsDevCache.Service.pipe(
      Effect.flatMap((service) => service.write(source, "new catalog")),
      Effect.provide(Layer.fresh(ModelsDevCache.layer)),
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        rename: (file) => Deferred.succeed(staged, file).pipe(Effect.andThen(Effect.never)),
      }),
      Effect.forkScoped,
    )
    const temporary = yield* Deferred.await(staged)
    expect(yield* fs.readFileString(temporary)).toBe("new catalog")
    expect((yield* cache.read(source))?.body).toBe("old catalog")

    yield* Fiber.interrupt(writer)
    expect((yield* cache.read(source))?.body).toBe("old catalog")
    expect(yield* fs.readDirectory(path.join(global.cache, "models-dev"))).toEqual([`${Hash.fast(source)}.json`])
  }),
)
