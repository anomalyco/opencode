import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Provider } from "../../provider.js"

export const AnthropicPlugin = define({
  id: "opencode.provider.anthropic",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (!Provider.isAISDK(item.provider.package)) continue
        if (Provider.packageName(item.provider.package) !== "@ai-sdk/anthropic") continue
        evt.provider.update(item.provider.id, (provider) => {
          provider.headers = {
            ...provider.headers,
            "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
          }
        })
      }
    })
  }),
})
