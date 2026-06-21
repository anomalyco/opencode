import { Effect } from "effect"
import { Integration } from "../../integration"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const OpencodePlugin = PluginV2.define({
  id: PluginV2.ID.make("opencode"),
  effect: Effect.gen(function* () {
    const integrations = yield* Integration.Service
    let hasKey = false
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        const item = evt.provider.get(ProviderV2.ID.opencode)
        if (!item) return
        const integration = yield* integrations.get(Integration.ID.make(item.provider.id))
        hasKey = Boolean(
          process.env.OPENCODE_API_KEY || integration?.connections.length || item.provider.request.body.apiKey,
        )
        evt.provider.update(item.provider.id, (provider) => {
          if (!hasKey) provider.request.body.apiKey = "public"
        })
        if (hasKey) return
        for (const model of item.models.values()) {
          if (!model.cost.some((cost) => cost.input > 0)) continue
          evt.model.update(item.provider.id, model.id, (draft) => {
            draft.enabled = false
          })
        }
      }),
    }
  }),
})
