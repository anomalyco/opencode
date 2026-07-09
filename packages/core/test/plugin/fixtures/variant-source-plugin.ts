import { Plugin } from "@opencode-ai/plugin/v2/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"

export default Plugin.define({
  id: "variant-source",
  effect: (ctx) =>
    ctx.catalog
      .transform((catalog) => {
        catalog.provider.update("configured", (provider) => {
          provider.package = ProviderV2.aisdk("@ai-sdk/openai-compatible")
        })
        catalog.model.update("configured", "glm-5.2", (model) => {
          model.modelID = "glm-5.2"
          model.package = ProviderV2.aisdk("@ai-sdk/openai-compatible")
          model.variants = [
            {
              id: "high",
              settings: {},
              headers: { custom: "true" },
              body: {},
            },
          ]
        })
      })
      .pipe(Effect.asVoid),
})
