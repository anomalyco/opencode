import type { ModelsDev } from "../models"

interface OpenAIModel {
  id: string
  object?: string
  created?: number
  owned_by?: string
}

interface OpenAIModelsResponse {
  object?: string
  data?: OpenAIModel[]
}

const baseURL = "http://localhost:8888"

async function fetchModels(): Promise<Record<string, ModelsDev.Model>> {
  const res = await fetch(`${baseURL}/v1/models`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined)

  if (!res?.ok) return {}

  const json = (await res.json().catch(() => ({}))) as OpenAIModelsResponse
  const data = json.data ?? []
  const models: Record<string, ModelsDev.Model> = {}

  for (const m of data) {
    models[m.id] = {
      id: m.id,
      name: m.id,
      family: "",
      release_date: new Date((m.created ?? Date.now()) * 1000).toISOString(),
      attachment: false,
      reasoning: false,
      temperature: false,
      tool_call: true,
      limit: {
        context: 128000,
        output: 4096,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
      options: {},
      provider: {
        api: baseURL,
        npm: "@ai-sdk/openai-compatible",
      },
    }
  }

  return models
}

export const literbike = {
  id: "literbike",
  name: "Literbike",
  env: [],
  models: await fetchModels(),
}
