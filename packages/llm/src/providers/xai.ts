import { Auth } from "../adapter/auth"
import type { ProviderAuthOption } from "../adapter/auth-options"
import { Adapter } from "../adapter/client"
import type { AdapterModelInput } from "../adapter/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import * as OpenAIResponses from "../protocols/openai-responses"

export const id = ProviderID.make("xai")

export type ModelOptions = Omit<AdapterModelInput, "id" | "apiKey" | "auth"> & ProviderAuthOption<"optional">

export const adapters = [OpenAIResponses.adapter, OpenAICompatibleChat.adapter]

const responsesModel = Adapter.model(OpenAIResponses.adapter, { provider: id })
const chatModel = OpenAICompatibleChat.model

const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("XAI_API_KEY"))
    .bearer()
}

export const responses = (modelID: string | ModelID, options: ModelOptions = {}) => {
  const { apiKey: _, ...rest } = options
  return responsesModel({
    ...rest,
    auth: auth(options),
    id: modelID,
    baseURL: options.baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL,
  })
}

export const chat = (modelID: string | ModelID, options: ModelOptions = {}) => {
  const { apiKey: _, ...rest } = options
  return chatModel({
    ...rest,
    auth: auth(options),
    id: modelID,
    provider: id,
    baseURL: options.baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL,
  })
}

export const provider = Provider.make({
  id,
  model: responses,
  apis: { responses, chat },
})

export const model = provider.model
export const apis = provider.apis
