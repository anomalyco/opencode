import { Auth } from "../adapter/auth"
import type { ProviderAuthOption } from "../adapter/auth-options"
import type { AdapterModelInput } from "../adapter/client"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export type { OpenAIOptionsInput } from "./openai-options"

export const adapters = [OpenAIResponses.adapter, OpenAIChat.adapter]

type OpenAIModelInput<ModelInput> = Omit<ModelInput, "apiKey" | "auth"> & ProviderAuthOption<"optional"> & {
  readonly providerOptions?: OpenAIProviderOptionsInput
}

const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("OPENAI_API_KEY"))
    .bearer()
}

export const responses = (id: string, options: OpenAIModelInput<Omit<AdapterModelInput, "id">> = {}) => {
  return OpenAIResponses.model(withOpenAIOptions(id, { ...options, auth: auth(options) }, { textVerbosity: true }))
}

export const chat = (id: string, options: OpenAIModelInput<Omit<AdapterModelInput, "id">> = {}) => {
  return OpenAIChat.model(withOpenAIOptions(id, { ...options, auth: auth(options) }))
}

export const model = responses
