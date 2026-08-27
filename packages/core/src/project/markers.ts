export * as ProjectMarkers from "./markers.js"

import { FSUtil } from "@opencode-ai/util/fs-util"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import path from "path"
import { PluginDiscovery } from "../plugin/discovery.js"
import { SdkPlugins } from "../plugin/sdk.js"
import { AbsolutePath } from "../schema.js"

export interface Match {
  readonly type: string
  readonly directory: AbsolutePath
  readonly marker: AbsolutePath
}

export interface Interface {
  readonly discover: (directory: AbsolutePath) => Effect.Effect<Match | undefined>
  readonly targets: () => readonly string[]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectMarkers") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const sdk = yield* SdkPlugins.Service
    const discovery = yield* PluginDiscovery.Service
    const known = new Set([".git", ".hg"])

    const discover = Effect.fn("ProjectMarkers.discover")(function* (directory: AbsolutePath) {
      const operations = yield* discovery.operations(directory)
      const resolved = yield* discovery.resolve(sdk.all(), [], operations)
      const markers = new Map<string, string>()
      for (const plugin of resolved.plugins) {
        if (!plugin.vcs) continue
        const id = plugin.vcs.id ?? plugin.id
        if (!/^[a-z][a-z0-9._-]*$/.test(id)) continue
        for (const marker of plugin.vcs.markers) {
          if (!marker || marker === "." || marker === ".." || /[\\/]/.test(marker)) continue
          known.add(marker)
          markers.set(marker, id)
        }
      }
      if (!markers.size) return undefined

      const marker = yield* fs.up({ targets: [...markers.keys()], start: directory, mode: "first" }).pipe(
        Effect.map((entries) => entries[0]),
        Effect.orElseSucceed(() => undefined),
      )
      if (!marker) return undefined
      const type = markers.get(path.basename(marker))
      if (!type) return undefined
      return {
        type,
        directory: AbsolutePath.make(path.dirname(marker)),
        marker: AbsolutePath.make(marker),
      } satisfies Match
    })

    return Service.of({ discover, targets: () => [...known] })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, PluginDiscovery.node, SdkPlugins.node],
})
