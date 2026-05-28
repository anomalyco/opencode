import { Effect } from "effect"
import { PluginV2 } from "../../plugin"

export const ZenmuxPlugin = PluginV2.define({
  id: PluginV2.ID.make("zenmux"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        for (const item of evt.data) {
          if (item.provider.endpoint.type !== "aisdk") continue
          if (item.provider.endpoint.package !== "@ai-sdk/openai-compatible") continue
          if (item.provider.endpoint.url !== "https://zenmux.ai/api/v1") continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.options.headers["HTTP-Referer"] ??= "https://opencode.ai/"
            provider.options.headers["X-Title"] ??= "opencode"
          })
        }
      }),
    }
  }),
})
