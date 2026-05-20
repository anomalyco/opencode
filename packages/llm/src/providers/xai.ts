import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import type { RouteDefaultsInput } from "../route/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import * as OpenAIResponses from "../protocols/openai-responses"

export const id = ProviderID.make("xai")

export type ModelOptions = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
  }

export const routes = [OpenAIResponses.route, OpenAICompatibleChat.route]

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "XAI_API_KEY")

export const responses = (modelID: string | ModelID, options: ModelOptions = {}) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = options
  return OpenAIResponses.route
    .with({
      ...rest,
      provider: id,
      endpoint: { baseURL: baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL },
      auth: auth(options),
    })
    .model({ id: modelID })
}

export const chat = (modelID: string | ModelID, options: ModelOptions = {}) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = options
  return OpenAICompatibleChat.route
    .with({
      ...rest,
      provider: id,
      endpoint: { baseURL: baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL },
      auth: auth(options),
    })
    .model({ id: modelID })
}

export const provider = Provider.make({
  id,
  model: responses,
  apis: { responses, chat },
})

export const model = provider.model
export const apis = provider.apis
