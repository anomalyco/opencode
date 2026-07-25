import { Effect } from "effect"
import { define } from "../internal"

export const SiliconFlowPlugin = define({
  id: "siliconflow",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const id = "siliconflow"
        evt.provider.update(id, (provider) => {
          provider.name = "SiliconFlow"
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://api.siliconflow.cn/v1",
          }
        })
        const models: Array<{
          id: string
          name: string
          context: number
          output: number
          tools: boolean
          released: string
        }> = [
          { id: "Qwen/Qwen3-8B", name: "Qwen3-8B", context: 131000, output: 131000, tools: true, released: "2025-05-01" },
          { id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", name: "DeepSeek-R1-Distill-Qwen-7B", context: 131000, output: 32000, tools: false, released: "2025-01-01" },
        ]
        for (const m of models) {
          evt.model.update(id, m.id, (model) => {
            model.name = m.name
            model.api = { id: m.id, type: "aisdk", package: "@ai-sdk/openai-compatible" }
            model.capabilities = { tools: m.tools, input: ["text"], output: ["text"] }
            model.limit = { context: m.context, output: m.output }
            model.cost = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]
            model.time = { released: Date.parse(m.released) }
          })
        }
      }),
    )
  }),
})
