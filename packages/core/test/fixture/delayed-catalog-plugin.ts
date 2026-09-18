import { define } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"

export default define({
  id: "delayed-catalog",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* Effect.sleep("300 millis")
      yield* ctx.catalog.transform((catalog) => {
        catalog.provider.update("delayed-provider", (provider) => {
          provider.name = "Delayed"
          provider.request.body.apiKey = "test"
        })
        catalog.model.update("delayed-provider", "delayed-model", (model) => {
          model.name = "Delayed"
        })
      })
    }),
})
