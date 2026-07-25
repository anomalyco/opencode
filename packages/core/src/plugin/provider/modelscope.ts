import { Effect } from "effect"
import { define } from "../internal"

export const ModelScopePlugin = define({
  id: "modelscope",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const id = "modelscope"
        evt.provider.update(id, (provider) => {
          provider.name = "ModelScope"
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://api-inference.modelscope.cn/v1",
          }
        })
        const models: Array<{
          id: string
          name: string
          context: number
          output: number
          released: string
        }> = [
          { id: "Qwen/Qwen3.5-35B-A3B", name: "Qwen3.5-35B-A3B", context: 131000, output: 32000, released: "2025-06-01" },
          { id: "Qwen/Qwen3.5-27B", name: "Qwen3.5-27B", context: 131000, output: 32000, released: "2025-06-01" },
        ]
        for (const m of models) {
          evt.model.update(id, m.id, (model) => {
            model.name = m.name
            model.family = "qwen"
            model.api = { id: m.id, type: "aisdk", package: "@ai-sdk/openai-compatible" }
            model.capabilities = { tools: true, input: ["text"], output: ["text"] }
            model.limit = { context: m.context, output: m.output }
            model.cost = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]
            model.time = { released: Date.parse(m.released) }
          })
        }
      }),
    )
  }),
})
