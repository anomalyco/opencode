import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { ProviderV2 } from "../../provider"

export const ZenmuxPlugin = define({
  id: "opencode.provider.zenmux",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (!ProviderV2.isAISDK(item.provider.package)) continue
        if (ProviderV2.packageName(item.provider.package) !== "@ai-sdk/openai-compatible") continue
        if (item.provider.settings?.baseURL !== "https://zenmux.ai/api/v1") continue
        evt.provider.update(item.provider.id, (provider) => {
          provider.headers = {
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
            ...provider.headers,
          }
        })
      }
    })
  }),
})
