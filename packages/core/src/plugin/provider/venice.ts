import { Effect } from "effect"
import { PluginV2 } from "../../plugin"

export const VenicePlugin = PluginV2.define({
  id: PluginV2.ID.make("venice"),
  effect: Effect.gen(function* () {
    return {
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "venice-ai-sdk-provider") return
        const mod = yield* Effect.promise(() => import("venice-ai-sdk-provider"))
        evt.sdk = mod.createVenice(evt.options)
      }),
    }
  }),
})
