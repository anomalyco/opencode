import { Effect } from "effect"
import { PluginV2 } from "../../plugin"

export const MistralPlugin = PluginV2.define({
  id: PluginV2.ID.make("mistral"),
  effect: Effect.gen(function* () {
    return {
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/mistral") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/mistral"))
        evt.sdk = mod.createMistral(evt.options)
      }),
    }
  }),
})
