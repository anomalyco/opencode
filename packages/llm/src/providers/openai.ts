import { Auth } from "../adapter/auth"
import type { ProviderAuthOption } from "../adapter/auth-options"
import type { AdapterModelInput } from "../adapter/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export type { OpenAIOptionsInput } from "./openai-options"

export const id = ProviderID.make("openai")

export const adapters = [OpenAIResponses.adapter, OpenAIChat.adapter]

// This provider facade wraps the lower-level Responses and Chat model factories
// with OpenAI-specific conveniences: typed options, API-key sugar, env fallback,
// and default option normalization.
type OpenAIModelInput<ModelInput> = Omit<ModelInput, "apiKey" | "auth"> &
  ProviderAuthOption<"optional"> & {
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("OPENAI_API_KEY"))
    .bearer()
}

export const responses = (id: string | ModelID, options: OpenAIModelInput<Omit<AdapterModelInput, "id">> = {}) => {
  return OpenAIResponses.model(withOpenAIOptions(id, { ...options, auth: auth(options) }, { textVerbosity: true }))
}

export const chat = (id: string | ModelID, options: OpenAIModelInput<Omit<AdapterModelInput, "id">> = {}) => {
  return OpenAIChat.model(withOpenAIOptions(id, { ...options, auth: auth(options) }))
}

export const provider = Provider.make({
  id,
  model: responses,
  apis: { responses, chat },
})

export const model = provider.model
export const apis = provider.apis
