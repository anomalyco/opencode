import { Effect } from "effect"
import { PluginV2 } from "../../plugin"

export const GroqPlugin = PluginV2.define({
  id: PluginV2.ID.make("groq"),
  effect: Effect.gen(function* () {
    return {
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/groq") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/groq"))
        evt.sdk = mod.createGroq(evt.options)
      }),
    }
  }),
})
