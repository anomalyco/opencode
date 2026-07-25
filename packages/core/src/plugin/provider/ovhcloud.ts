import { Effect } from "effect"
import { define } from "../internal"

export const OVHcloudPlugin = define({
  id: "ovhcloud",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        const id = "ovhcloud"
        evt.provider.update(id, (provider) => {
          provider.name = "OVHcloud AI Endpoints"
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
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
          { id: "Qwen3.5-397B-A17B", name: "Qwen3.5-397B-A17B", context: 131000, output: 32000, tools: true, input: ["text"], outputType: ["text"], released: "2025-06-01" },
          { id: "gpt-oss-120b", name: "gpt-oss-120b", context: 128000, output: 32000, tools: true, input: ["text"], outputType: ["text"], released: "2025-05-01" },
          { id: "gpt-oss-20b", name: "gpt-oss-20b", context: 128000, output: 8000, tools: true, input: ["text"], outputType: ["text"], released: "2025-05-01" },
          { id: "Meta-Llama-3.3-70B-Instruct", name: "Meta-Llama-3.3-70B-Instruct", context: 131000, output: 4096, tools: true, input: ["text"], outputType: ["text"], released: "2024-12-01" },
          { id: "Llama-3.1-8B-Instruct", name: "Llama-3.1-8B-Instruct", context: 131000, output: 4096, tools: true, input: ["text"], outputType: ["text"], released: "2024-07-01" },
          { id: "Qwen3.6-27B", name: "Qwen3.6-27B", context: 131000, output: 32000, tools: true, input: ["text"], outputType: ["text"], released: "2025-06-01" },
          { id: "Qwen3.5-9B", name: "Qwen3.5-9B", context: 131000, output: 8000, tools: true, input: ["text"], outputType: ["text"], released: "2025-06-01" },
          { id: "Qwen3-32B", name: "Qwen3-32B", context: 131000, output: 32000, tools: true, input: ["text"], outputType: ["text"], released: "2025-05-01" },
          { id: "Qwen3-Coder-30B-A3B-Instruct", name: "Qwen3-Coder-30B-A3B-Instruct", context: 262000, output: 32000, tools: true, input: ["text"], outputType: ["text"], released: "2025-05-01" },
          { id: "Qwen2.5-VL-72B-Instruct", name: "Qwen2.5-VL-72B-Instruct", context: 128000, output: 8000, tools: true, input: ["text", "image"], outputType: ["text"], released: "2025-01-01" },
          { id: "Mistral-Small-3.2-24B-Instruct", name: "Mistral-Small-3.2-24B-Instruct", context: 128000, output: 4096, tools: true, input: ["text"], outputType: ["text"], released: "2025-06-01" },
          { id: "Mistral-Nemo-Instruct-2407", name: "Mistral-Nemo-Instruct-2407", context: 128000, output: 4096, tools: true, input: ["text"], outputType: ["text"], released: "2024-07-01" },
          { id: "Mistral-7B-Instruct-v0.3", name: "Mistral-7B-Instruct-v0.3", context: 32000, output: 4096, tools: true, input: ["text"], outputType: ["text"], released: "2024-05-01" },
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
