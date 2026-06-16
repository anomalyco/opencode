import { Effect } from "effect"
import { PluginV2 } from "../../plugin"

export const ManifestPlugin = PluginV2.define({
  id: PluginV2.ID.make("manifest"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (item.provider.id !== "manifest") continue
          if (item.provider.api.type !== "aisdk") continue
          if (item.provider.api.package !== "@ai-sdk/openai-compatible") continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.request.headers["X-Source"] = "opencode"
          })
        }
      }),
    }
  }),
})
