import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import * as PermissionClassifierCore from "@opencode-ai/core/permission/classifier"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"

/**
 * Create a classifier layer with the opencode model resolver.
 * This resolves models using the Provider service.
 */
const modelResolver: PermissionClassifierCore.ModelResolver = (providerID: string) =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service

    // Try to get the small model from the specified provider
    const smallModel = yield* provider.getSmallModel(ProviderV2.ID.make(providerID))
    if (smallModel) {
      return smallModel
    }

    // Try to get the small model from any available provider
    const providers = yield* provider.list()
    for (const p of Object.values(providers)) {
      const model = yield* provider.getSmallModel(ProviderV2.ID.make(p.id))
      if (model) {
        return model
      }
    }

    return undefined
  })

export const classifierLayer = PermissionClassifierCore.make(modelResolver)

export const node = LayerNode.make({
  service: PermissionClassifierCore.Service,
  layer: classifierLayer,
  deps: [Provider.node],
})
