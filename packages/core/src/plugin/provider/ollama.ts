import { Effect, Schema } from "effect"
import { createLocalProviderPlugin } from "./local.js"

const Details = Schema.Struct({
  parent_model: Schema.String.pipe(Schema.optional),
  format: Schema.String,
  family: Schema.String,
  families: Schema.Array(Schema.String).pipe(Schema.optional),
  parameter_size: Schema.String,
  quantization_level: Schema.String,
})

const RemoteModel = Schema.Struct({
  name: Schema.String,
  model: Schema.String,
  remote_model: Schema.String.pipe(Schema.optional),
  remote_host: Schema.String.pipe(Schema.optional),
  modified_at: Schema.String,
  size: Schema.Int,
  digest: Schema.String,
  details: Details,
})

const TagsResponse = Schema.Struct({ models: Schema.Array(RemoteModel) })
const ShowRequest = Schema.Struct({ model: Schema.String })
const ShowResponse = Schema.Struct({
  parameters: Schema.String.pipe(Schema.optional),
  license: Schema.String.pipe(Schema.optional),
  modified_at: Schema.String.pipe(Schema.optional),
  details: Details.pipe(Schema.optional),
  template: Schema.String.pipe(Schema.optional),
  capabilities: Schema.Array(Schema.String).pipe(Schema.optional),
  model_info: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
})

type DiscoveredModel = typeof RemoteModel.Type & { show: typeof ShowResponse.Type }
type ShowCache = {
  apiKey?: string
  entries: Map<string, { digest: string; info: typeof ShowResponse.Type }>
}

const shows = new Map<string, ShowCache>()

export const make = createLocalProviderPlugin({
  id: "opencode.provider.ollama",
  providerID: "ollama",
  name: "Ollama",
  origin: "http://127.0.0.1:11434",
  stripPathSuffix: /\/(?:v1|api)$/,
  discover: (client) =>
    Effect.gen(function* () {
      const cached = shows.get(client.root)
      const previous = cached && cached.apiKey === client.apiKey ? cached.entries : new Map()
      shows.set(client.root, { apiKey: client.apiKey, entries: previous })
      const response = yield* client.getJson("/api/tags", TagsResponse)
      const summaries = response.models
        .filter((model) => model.model.length > 0)
        .toSorted((a, b) => a.model.localeCompare(b.model))
      const entries = new Map<string, { digest: string; info: typeof ShowResponse.Type }>()
      const models = yield* Effect.forEach(
        summaries,
        (model) =>
          Effect.gen(function* () {
            const saved = previous.get(model.model)
            const info =
              saved?.digest === model.digest
                ? saved.info
                : yield* client.postJson("/api/show", ShowRequest, { model: model.model }, ShowResponse)
            entries.set(model.model, { digest: model.digest, info })
            return { ...model, show: info }
          }).pipe(Effect.orElseSucceed(() => undefined)),
        { concurrency: 4 },
      )
      shows.set(client.root, { apiKey: client.apiKey, entries })
      return models.filter(
        (model): model is DiscoveredModel =>
          model !== undefined && (model.show.capabilities?.includes("completion") ?? false),
      )
    }),
  model: (item) => ({
    id: item.model,
    name: item.name || item.model,
    family: item.show.details?.family || item.details.family,
    tools: item.show.capabilities?.includes("tools"),
    vision: item.show.capabilities?.includes("vision"),
    context: Object.entries(item.show.model_info ?? {}).flatMap(([key, value]) =>
      key.endsWith(".context_length") && typeof value === "number" && value > 0 ? [value] : [],
    )[0],
  }),
})

export const OllamaPlugin = make()
