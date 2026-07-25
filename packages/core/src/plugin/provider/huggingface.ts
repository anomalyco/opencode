import { Effect } from "effect"
import { define } from "../internal"

export const HuggingFacePlugin = define({
  id: "huggingface",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const id = "huggingface"
        evt.provider.update(id, (provider) => {
          provider.name = "Hugging Face"
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://router.huggingface.co/v1",
          }
          provider.request.headers["HTTP-Referer"] = "https://opencode.ai/"
          provider.request.headers["X-Title"] = "opencode"
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
          { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", name: "Meta-Llama-3.1-8B-Instruct", context: 128000, output: 4096, tools: true, input: ["text"], outputType: ["text"], released: "2024-07-01" },
          { id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral-7B-Instruct-v0.3", context: 32000, output: 4096, tools: true, input: ["text"], outputType: ["text"], released: "2024-05-01" },
          { id: "mistralai/Mixtral-8x7B-Instruct-v0.1", name: "Mixtral-8x7B-Instruct-v0.1", context: 32000, output: 4096, tools: true, input: ["text"], outputType: ["text"], released: "2024-01-01" },
          { id: "microsoft/Phi-3.5-mini-instruct", name: "Phi-3.5-mini-instruct", context: 128000, output: 4096, tools: true, input: ["text"], outputType: ["text"], released: "2024-08-01" },
          { id: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen2.5-7B-Instruct", context: 131000, output: 4096, tools: true, input: ["text"], outputType: ["text"], released: "2024-09-01" },
        ]
        for (const m of models) {
          evt.model.update(id, m.id, (model) => {
            model.name = m.name
            model.family = m.id.split("/")[1]?.split("-")[0] ?? m.id
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
