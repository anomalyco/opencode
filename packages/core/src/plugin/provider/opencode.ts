import { Effect } from "effect"
import { define } from "../internal"
import { ProviderV2 } from "../../provider"
import { Integration } from "../../integration"

export const OpencodePlugin = define({
  id: "opencode",
  effect: Effect.fn(function* (ctx) {
    const integrations = yield* Integration.Service
    let hasKey = false
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
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
    )
  }),
})
