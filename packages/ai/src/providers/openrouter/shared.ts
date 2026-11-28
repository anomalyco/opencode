import { Schema } from "effect"
import { JsonObject, lenient } from "../../protocols/shared.js"
import { Provider } from "../../provider.js"

/** What every OpenRouter API shares. Each per-API entrypoint builds a provider from it with only its own API. */
export const shared = {
  id: "openrouter",
  baseURL: "https://openrouter.ai/api/v1",
  auth: Provider.apiKey("OPENROUTER_API_KEY"),
} satisfies Omit<Provider.Input<[]>, "apis">

/** Routing options both APIs send at the top level of the body. */
export const SharedOptions = Schema.Struct({
  models: lenient(Schema.Array(Schema.String)),
  provider: lenient(JsonObject),
  plugins: lenient(Schema.Array(JsonObject)),
  debug: lenient(JsonObject),
  user: lenient(Schema.String),
})

export const sharedOptions = (known: typeof SharedOptions.Type) => ({
  ...(known.models !== undefined ? { models: known.models } : {}),
  ...(known.provider !== undefined ? { provider: known.provider } : {}),
  ...(known.plugins !== undefined ? { plugins: known.plugins } : {}),
  ...(known.debug !== undefined ? { debug: known.debug } : {}),
  ...(known.user !== undefined ? { user: known.user } : {}),
})
