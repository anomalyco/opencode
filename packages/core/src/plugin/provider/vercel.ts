import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const VercelPlugin = PluginV2.define({
  id: PluginV2.ID.make("vercel"),
  effect: Effect.gen(function* () {
    return {
      "provider.update": Effect.fn(function* (evt) {
        if (evt.provider.id !== ProviderV2.ID.make("vercel")) return
        evt.provider.options.headers["http-referer"] = "https://opencode.ai/"
        evt.provider.options.headers["x-title"] = "opencode"
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/vercel") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/vercel"))
        evt.sdk = mod.createVercel(evt.options)
      }),
    }
  }),
})
