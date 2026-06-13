import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const OmniRoutePlugin = PluginV2.define({
  id: PluginV2.ID.make("omniroute"),
  effect: Effect.gen(function* () {
    return {
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.sdk) return
        if (evt.model.providerID !== ProviderV2.ID.omniroute) return
        if (!evt.package.includes("@ai-sdk/openai-compatible")) return
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai-compatible"))
        evt.sdk = mod.createOpenAICompatible(evt.options as any)
      }),
    }
  }),
})
