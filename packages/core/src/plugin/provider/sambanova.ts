import { Effect } from "effect"
import { define } from "../internal"

export const SambaNovaPlugin = define({
  id: "sambanova",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const id = "sambanova"
        evt.provider.update(id, (provider) => {
          provider.name = "SambaNova"
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://api.sambanova.ai/v1",
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
          { id: "DeepSeek-V3.1", name: "DeepSeek-V3.1", context: 128000, output: 8000, tools: true, released: "2025-06-01" },
          { id: "DeepSeek-V3.2", name: "DeepSeek-V3.2 (Preview)", context: 128000, output: 8000, tools: true, released: "2025-07-01" },
          { id: "Meta-Llama-3.3-70B-Instruct", name: "Meta-Llama-3.3-70B-Instruct", context: 128000, output: 8000, tools: true, released: "2024-12-01" },
          { id: "gpt-oss-120b", name: "gpt-oss-120b", context: 128000, output: 8000, tools: true, released: "2025-05-01" },
          { id: "MiniMax-M2.7", name: "MiniMax-M2.7", context: 128000, output: 8000, tools: true, released: "2025-06-01" },
          { id: "gemma-4-31B-it", name: "gemma-4-31B-it (Preview)", context: 128000, output: 8000, tools: true, released: "2025-06-01" },
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
