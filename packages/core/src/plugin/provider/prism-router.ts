import { Effect } from "effect"
import { define } from "../internal"

export const PrismRouterPlugin = define({
  id: "prism-router",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        evt.provider.update("prism-router", (provider) => {
          provider.name = "Prism Router"
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://prism-router-production.up.railway.app/v1",
          }
          provider.request.headers["Content-Type"] = "application/json"
        })
        evt.model.update("prism-router", "model-router/auto", (model) => {
          model.name = "Auto (cache-aware route)"
          model.family = "prism-router"
          model.api = {
            type: "native",
            url: "https://prism-router-production.up.railway.app/v1",
            settings: {},
          }
          model.capabilities = { tools: true, input: ["text"], output: ["text"] }
          model.limit = { context: 128_000, output: 16_384 }
          model.time.released = Date.now()
          model.status = "active"
          model.enabled = true
          model.cost = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]
        })
      }),
    )
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.sdk) return
        if (!evt.package.includes("@ai-sdk/openai-compatible")) return
        if (evt.options.includeUsage !== false) evt.options.includeUsage = true
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai-compatible"))
        evt.sdk = mod.createOpenAICompatible(evt.options as any)
      }),
    )
  }),
})
