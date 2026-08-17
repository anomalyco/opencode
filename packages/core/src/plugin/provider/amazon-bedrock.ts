import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Provider } from "../../provider.js"

export const AmazonBedrockPlugin = define({
  id: "opencode.provider.amazon-bedrock",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (!Provider.isAISDK(item.provider.package)) continue
        if (Provider.packageName(item.provider.package) !== "@ai-sdk/amazon-bedrock") continue
        evt.provider.update(item.provider.id, (provider) => {
          if (typeof provider.settings?.endpoint !== "string") return
          // The AI SDK expects a base URL, but users configure Bedrock private/VPC
          // endpoints as `endpoint`; move it into the catalog endpoint URL once.
          provider.settings.baseURL = provider.settings.endpoint
          delete provider.settings.endpoint
        })
      }
    })
  }),
})
