import { define } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"

export default define({
  id: "variant-source",
  effect: (ctx) =>
    ctx.catalog
      .transform((catalog) => {
        catalog.provider.update("configured", (provider) => {
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible" }
        })
        catalog.model.update("configured", "glm-5.2", (model) => {
          model.api = {
            id: "glm-5.2",
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
          }
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
