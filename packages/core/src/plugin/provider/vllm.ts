import { Effect, Schema } from "effect"
import { createLocalProviderPlugin } from "./local.js"

const providerID = "vllm"

const RemoteModel = Schema.Struct({
  id: Schema.String,
  owned_by: Schema.String,
  max_model_len: Schema.NullOr(Schema.Int),
})

const Response = Schema.Struct({ data: Schema.Array(RemoteModel) })

export const make = createLocalProviderPlugin({
  id: "opencode.provider.vllm",
  providerID,
  name: "vLLM",
  origin: "http://127.0.0.1:8000",
  discover: (client) =>
    Effect.gen(function* () {
      yield* client.get("/health")
      const response = yield* client.getJson("/v1/models", Response)
      return response.data
        .filter((model) => model.owned_by === providerID && model.id.length > 0)
        .toSorted((a, b) => a.id.localeCompare(b.id))
    }),
  // Tool calling depends on vLLM server flags and parsers that model discovery does not report.
  model: (item) => ({
    id: item.id,
    context: item.max_model_len,
  }),
})

export const VLLMPlugin = make()
