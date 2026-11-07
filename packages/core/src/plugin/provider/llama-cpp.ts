import { Effect, Schema } from "effect"
import { createLocalProviderPlugin } from "./local.js"

const RemoteModel = Schema.Struct({
  id: Schema.String,
  object: Schema.Literals(["model"]),
  owned_by: Schema.String.pipe(Schema.optional),
  root: Schema.String.pipe(Schema.optional),
  parent: Schema.String.pipe(Schema.optional),
  max_context_length: Schema.Int.pipe(Schema.optional),
  capabilities: Schema.Struct({
    completion_prompt: Schema.Boolean.pipe(Schema.optional),
    completion: Schema.Boolean.pipe(Schema.optional),
    messages: Schema.Boolean.pipe(Schema.optional),
    images: Schema.Boolean.pipe(Schema.optional),
    function_call: Schema.Boolean.pipe(Schema.optional),
    parallel_tool_calls: Schema.Boolean.pipe(Schema.optional),
  }).pipe(Schema.optional),
})

const Response = Schema.Struct({ data: Schema.Array(RemoteModel) })
const DetailResponse = RemoteModel

type DiscoveredModel = typeof RemoteModel.Type & { detail: typeof RemoteModel.Type }
type DetailCache = {
  apiKey?: string
  entries: Map<string, { info: typeof RemoteModel.Type }>
}

const details = new Map<string, DetailCache>()

export const make = createLocalProviderPlugin({
  id: "opencode.provider.llama-cpp",
  providerID: "llama-cpp",
  name: "llama.cpp",
  origin: "http://127.0.0.1:8080",
  discover: (client) =>
    Effect.gen(function* () {
      const cached = details.get(client.root)
      const previous = cached && cached.apiKey === client.apiKey ? cached.entries : new Map()
      details.set(client.root, { apiKey: client.apiKey, entries: previous })
      const response = yield* client.getJson("/v1/models", Response)
      const summaries = response.data
        .filter((model) => model.id.length > 0)
        .toSorted((a, b) => a.id.localeCompare(b.id))

      const entries = new Map<string, { info: typeof DetailResponse.Type }>()
      const models: DiscoveredModel[] = yield* Effect.forEach(
        summaries,
        (model) =>
          Effect.gen(function* () {
            const saved = previous.get(model.id)
            const info =
              saved ? saved.info : yield* client.getJson(`/v1/models/${encodeURIComponent(model.id)}`, DetailResponse)
            entries.set(model.id, { info })
            return { ...model, detail: info }
          }).pipe(Effect.orElseSucceed(() => ({ ...model, detail: model }))),
        { concurrency: 4 },
      )
      details.set(client.root, { apiKey: client.apiKey, entries })
      return models
    }),
  model: (item) => ({
    id: item.id,
    name: item.id,
    family: item.detail.parent ?? item.detail.root ?? item.detail.owned_by ?? item.parent ?? item.root ?? item.owned_by,
    tools: (item.detail.capabilities?.messages ?? item.capabilities?.messages) === true,
    vision: (item.detail.capabilities?.images ?? item.capabilities?.images) === true,
    context: item.detail.max_context_length ?? item.max_context_length,
  }),
})

export const LlamaCppPlugin = make()
