import type { FileSystem } from "@Mackery6969/core/filesystem"
import { Bus } from "@Mackery6969/core/bus"
import { Image } from "@Mackery6969/core/image"
import { LocationServiceMap } from "@Mackery6969/core/location-service-map"
import type { LocationServices } from "@Mackery6969/core/location-services"
import { Plugin } from "@Mackery6969/core/plugin"
import { PluginHooks } from "@Mackery6969/core/plugin/hooks"
import { Skill } from "@Mackery6969/core/skill"
import type { Location } from "@Mackery6969/schema/location"
import { makeGlobalNode } from "@Mackery6969/util/effect/app-node"
import { LayerNode } from "@Mackery6969/util/effect/layer-node"
import { Effect, Layer, LayerMap } from "effect"

// Plain-prompt unit fixtures use virtual directories.
export const promptLocationNode = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* LayerMap.make(
        (_ref: Location.Ref) =>
          LayerNode.compile(LayerNode.group([PluginHooks.node, Image.node, Skill.node, Plugin.node]), {
            replacements: [
              Bus.node.replace(Layer.succeed(Bus.Service, bus)),
              Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
            ],
          }) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      )
    }),
  ),
  deps: [Bus.node],
})
