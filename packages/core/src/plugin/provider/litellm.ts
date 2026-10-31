import { Effect, Schema } from "effect"
import { createLocalProviderPlugin } from "./local.js"

const RemoteModel = Schema.Struct({
  id: Schema.String,
  // LiteLLM reports these only when it knows the model, and older proxies omit them.
  mode: Schema.NullOr(Schema.String).pipe(Schema.optional),
  max_input_tokens: Schema.NullOr(Schema.Finite).pipe(Schema.optional),
})

const Response = Schema.Struct({ data: Schema.Array(RemoteModel) })

// Only LiteLLM gives this body on this path. Other OpenAI-compatible servers on port 4000 are not shown as LiteLLM.
const Liveliness = Schema.Literal("I'm alive!")

export const make = createLocalProviderPlugin({
  id: "opencode.provider.litellm",
  providerID: "litellm",
  name: "LiteLLM",
  origin: "http://127.0.0.1:4000",
  discover: (client) =>
    Effect.gen(function* () {
      yield* client.getJson("/health/liveliness", Liveliness)
      const response = yield* client.getJson("/v1/models", Response)
      return response.data
        .filter((model) => model.id.length > 0 && (model.mode ?? "chat") === "chat")
        .toSorted((a, b) => a.id.localeCompare(b.id))
    }),
  // Tool and image support depend on the model behind each alias, which /v1/models does not report.
  model: (item) => ({ id: item.id, context: item.max_input_tokens }),
})

export const LiteLLMPlugin = make()
