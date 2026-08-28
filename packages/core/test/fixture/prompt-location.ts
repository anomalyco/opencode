import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor-service"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { stubLocations } from "./location"

// Plain-prompt unit fixtures use virtual directories and need only the admission hook services.
export const promptLocationLayer = stubLocations(
  Layer.merge(LayerNode.compile(PluginHooks.node), Layer.succeed(PluginSupervisor.Service, { flush: Effect.void })),
)
