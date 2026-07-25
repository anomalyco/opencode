import { Effect } from "effect"
import { define } from "../internal"

export const GitHubModelsPlugin = define({
  id: "github-models",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const id = "github-models"
        evt.provider.update(id, (provider) => {
          provider.name = "GitHub Models"
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://models.github.ai/inference",
          }
        })
        const models: Array<{
          id: string
          name: string
          context: number
          output: number
          tools: boolean
          input: string[]
          outputType: string[]
          released: string
        }> = [
          { id: "gpt-5", name: "gpt-5", context: 200000, output: 32000, tools: true, input: ["text"], outputType: ["text"], released: "2025-07-01" },
          { id: "gpt-4.1", name: "gpt-4.1", context: 1000000, output: 32000, tools: true, input: ["text"], outputType: ["text"], released: "2025-04-01" },
          { id: "gpt-4.1-mini", name: "gpt-4.1-mini", context: 1000000, output: 32000, tools: true, input: ["text"], outputType: ["text"], released: "2025-04-01" },
          { id: "gpt-4o", name: "gpt-4o", context: 128000, output: 16000, tools: true, input: ["text", "image"], outputType: ["text"], released: "2024-05-01" },
          { id: "o4-mini", name: "o4-mini", context: 200000, output: 100000, tools: true, input: ["text"], outputType: ["text"], released: "2025-06-01" },
          { id: "llama-4-scout-17b-16e", name: "Llama-4-Scout-17B-16E", context: 512000, output: 4096, tools: true, input: ["text", "image"], outputType: ["text"], released: "2025-04-01" },
          { id: "llama-4-maverick-17b-128e", name: "Llama-4-Maverick-17B-128E", context: 256000, output: 4096, tools: true, input: ["text", "image"], outputType: ["text"], released: "2025-04-01" },
          { id: "meta-llama-3.3-70b", name: "Meta-Llama-3.3-70B", context: 131000, output: 4096, tools: true, input: ["text"], outputType: ["text"], released: "2024-12-01" },
          { id: "deepseek-r1", name: "DeepSeek-R1", context: 64000, output: 8000, tools: false, input: ["text"], outputType: ["text"], released: "2025-01-01" },
          { id: "mistral-small-3.1", name: "Mistral-Small-3.1", context: 128000, output: 4096, tools: true, input: ["text", "image"], outputType: ["text"], released: "2025-05-01" },
        ]
        for (const m of models) {
          evt.model.update(id, m.id, (model) => {
            model.name = m.name
            model.api = { id: m.id, type: "aisdk", package: "@ai-sdk/openai-compatible" }
            model.capabilities = { tools: m.tools, input: [...m.input], output: [...m.outputType] }
            model.limit = { context: m.context, output: m.output }
            model.cost = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]
            model.time = { released: Date.parse(m.released) }
          })
        }
      }),
    )
  }),
})
