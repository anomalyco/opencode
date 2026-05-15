import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const KiloPlugin = PluginV2.define({
  id: PluginV2.ID.make("kilo"),
  effect: Effect.gen(function* () {
    return {
      "provider.update": Effect.fn(function* (evt) {
        if (evt.provider.id !== ProviderV2.ID.make("kilo")) return
        evt.provider.options.headers["HTTP-Referer"] = "https://opencode.ai/"
        evt.provider.options.headers["X-Title"] = "opencode"
      }),
    }
  }),
})
