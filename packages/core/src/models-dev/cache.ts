export * as ModelsDevCache from "./cache.js"

import path from "path"
import { Context, Effect, FileSystem, Layer, Option } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { LayerNodePlatform } from "@opencode-ai/util/effect/app-node-platform"
import { Global } from "@opencode-ai/util/global"
import { Hash } from "@opencode-ai/util/hash"

export interface Entry {
  readonly body: string
  readonly updatedAt: number
}

export interface Interface {
  readonly read: (source: string) => Effect.Effect<Entry | undefined, PlatformError>
  readonly write: (source: string, body: string) => Effect.Effect<void, PlatformError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDevCache") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const directory = path.join(global.cache, "models-dev")

    const read = Effect.fn("ModelsDevCache.read")(
      function* (source: string) {
        const file = path.join(directory, `${Hash.fast(source)}.json`)
        const body = yield* fs.readFileString(file)
        const info = yield* fs.stat(file)
        return { body, updatedAt: Option.getOrUndefined(info.mtime)?.getTime() ?? 0 }
      },
      Effect.catchReason("PlatformError", "NotFound", () => Effect.undefined),
    )

    const write = Effect.fn("ModelsDevCache.write")(function* (source: string, body: string) {
      yield* fs.makeDirectory(directory, { recursive: true })
      const temporary = yield* fs.makeTempFileScoped({ directory, prefix: ".tmp-" })
      yield* fs.writeFileString(temporary, body)
      yield* fs.rename(temporary, path.join(directory, `${Hash.fast(source)}.json`))
    }, Effect.scoped)

    return Service.of({ read, write })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [LayerNodePlatform.filesystem, Global.node],
})

export const disabledLayer = Layer.succeed(
  Service,
  Service.of({ read: () => Effect.undefined, write: () => Effect.void }),
)
