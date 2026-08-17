import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Provider } from "../../provider.js"

export const ZenmuxPlugin = define({
  id: "opencode.provider.zenmux",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (!Provider.isAISDK(item.provider.package)) continue
        if (Provider.packageName(item.provider.package) !== "@ai-sdk/openai-compatible") continue
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
