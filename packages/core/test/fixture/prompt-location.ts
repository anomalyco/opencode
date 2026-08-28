import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor-service"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Effect, Layer, LayerMap } from "effect"

// Plain-prompt unit fixtures use virtual directories and need only the admission hook services.
export const promptLocationLayer = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () =>
      Layer.merge(
        LayerNode.compile(PluginHooks.node),
        Layer.succeed(PluginSupervisor.Service, {
          flush: Effect.void,
          check: () => Effect.succeed({ mutable: false }),
        }),
      ) as Layer.Layer<LocationServices>,
  ),
)
