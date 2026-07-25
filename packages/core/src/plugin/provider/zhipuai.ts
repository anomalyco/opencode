import { Effect } from "effect"
import { define } from "../internal"

export const ZhipuAIPlugin = define({
  id: "zhipuai",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const providerID = "zhipuai"
        evt.provider.update(providerID, (provider) => {
          provider.name = "Z AI (Zhipu AI)"
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://open.bigmodel.cn/api/paas/v4",
          }
          provider.request.headers["HTTP-Referer"] = "https://opencode.ai/"
          provider.request.headers["X-Title"] = "opencode"
        })
        evt.model.update(providerID, "glm-4.7-flash", (model) => {
          model.name = "GLM-4.7-Flash"
          model.family = "glm"
          model.api = { id: "glm-4.7-flash", type: "aisdk", package: "@ai-sdk/openai-compatible" }
          model.capabilities = { tools: true, input: ["text"], output: ["text"] }
          model.limit = { context: 200000, output: 128000 }
          model.cost = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]
          model.time = { released: Date.parse("2025-05-01") }
        })
        evt.model.update(providerID, "glm-4.6v-flash", (model) => {
          model.name = "GLM-4.6V-Flash"
          model.family = "glm"
          model.api = { id: "glm-4.6v-flash", type: "aisdk", package: "@ai-sdk/openai-compatible" }
          model.capabilities = { tools: true, input: ["text", "image"], output: ["text"] }
          model.limit = { context: 128000, output: 4096 }
          model.cost = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]
          model.time = { released: Date.parse("2025-04-01") }
        })
      }),
    )
  }),
})
