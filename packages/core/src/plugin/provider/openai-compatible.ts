import { Effect } from "effect"
import { PluginV2 } from "../../plugin"

export const OpenAICompatiblePlugin = PluginV2.define({
  id: PluginV2.ID.make("openai-compatible"),
  effect: Effect.gen(function* () {
    return {
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.sdk) return
        if (!evt.package.includes("@ai-sdk/openai-compatible")) return
        if (evt.options.includeUsage !== false) evt.options.includeUsage = true
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai-compatible"))
        evt.sdk = mod.createOpenAICompatible(evt.options as any)
      }),
    }
  }),
})
