import { Bus } from "@opencode-ai/core/bus"
import { Image } from "@opencode-ai/core/image"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor-service"
import { SessionPrompt } from "@opencode-ai/core/session/prompt"
import { Skill } from "@opencode-ai/core/skill"
import type { Location } from "@opencode-ai/schema/location"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Effect, Layer, LayerMap } from "effect"

// Plain-prompt unit fixtures use virtual directories and need only prompt preparation services.
export const promptLocationNode = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const fs = yield* FSUtil.Service
      return yield* LayerMap.make(
        (_ref: Location.Ref) =>
          SessionPrompt.layer.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                LayerNode.compile(LayerNode.group([PluginHooks.node, Image.node, Skill.node]), [
                  [Bus.node, Layer.succeed(Bus.Service, bus)],
                ]),
                Layer.succeed(FSUtil.Service, fs),
                Layer.succeed(PluginSupervisor.Service, { flush: Effect.void }),
              ),
            ),
          ) as Layer.Layer<LocationServices>,
      )
    }),
  ),
  deps: [Bus.node, FSUtil.node],
})
