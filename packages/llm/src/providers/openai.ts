import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import type { RouteModelInput } from "../route/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export type { OpenAIOptionsInput } from "./openai-options"

export const id = ProviderID.make("openai")

export const routes = [OpenAIResponses.route, OpenAIResponses.webSocketRoute, OpenAIChat.route]

// This provider facade wraps the lower-level Responses and Chat model factories
// with OpenAI-specific conveniences: typed options, API-key sugar, env fallback,
// and default option normalization.
type OpenAIModelInput<ModelInput> = Omit<ModelInput, "apiKey" | "auth" | "baseURL"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "OPENAI_API_KEY")

export const responses = (id: string | ModelID, options: OpenAIModelInput<Omit<RouteModelInput, "id">> = {}) => {
  const { apiKey: _, ...rest } = options
  return OpenAIResponses.model(withOpenAIOptions(id, { ...rest, auth: auth(options) }, { textVerbosity: true }))
}

export const responsesWebSocket = (
  id: string | ModelID,
  options: OpenAIModelInput<Omit<RouteModelInput, "id">> = {},
) => {
  const { apiKey: _, ...rest } = options
  return OpenAIResponses.webSocketModel(
    withOpenAIOptions(id, { ...rest, auth: auth(options) }, { textVerbosity: true }),
  )
}

export const chat = (id: string | ModelID, options: OpenAIModelInput<Omit<RouteModelInput, "id">> = {}) => {
  const { apiKey: _, ...rest } = options
  return OpenAIChat.model(withOpenAIOptions(id, { ...rest, auth: auth(options) }))
}

export const provider = Provider.make({
  id,
  model: responses,
  apis: { responses, responsesWebSocket, chat },
})

export const model = provider.model
export const apis = provider.apis
