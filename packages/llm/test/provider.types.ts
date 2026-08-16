import { Provider } from "../src/provider"
import { ProviderID, type Model } from "../src/schema"

declare const model: (id: string) => Model
declare const requiredModel: (id: string, options: { readonly baseURL: string }) => Model
declare const chat: (id: string, options: { readonly apiKey: string }) => Model

Provider.make({
  id: ProviderID.make("example"),
  model,
})

Provider.make({
  id: ProviderID.make("bad"),
  model,
  // @ts-expect-error provider definitions should not grow accidental top-level fields.
  routes: [],
})

const requiredProvider = Provider.make({
  id: ProviderID.make("required"),
  model: requiredModel,
})

// Provider.make is advanced structural typing coverage; built-in providers use
// configure(...).model(id) facades instead of second-argument selectors.
requiredProvider.model("custom", { baseURL: "https://example.com/v1" })

// @ts-expect-error Provider.make preserves required model options.
requiredProvider.model("custom")

const multiApiProvider = Provider.make({
  id: ProviderID.make("multi-api"),
  model,
  apis: { chat },
})

multiApiProvider.apis.chat("chat-model", { apiKey: "key" })

// @ts-expect-error Provider.make preserves API-specific option types.
multiApiProvider.apis.chat("chat-model")
