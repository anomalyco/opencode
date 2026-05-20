import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import type { Route, RouteModelInput } from "../route/client"
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
    readonly queryParams?: Record<string, string>
    readonly providerOptions?: OpenAIProviderOptionsInput
  }
export type Config = OpenAIModelInput<Omit<RouteModelInput, "id">>

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "OPENAI_API_KEY")

const defaults = (input: Config) => {
  const { apiKey: _, auth: _auth, baseURL: _baseURL, queryParams: _queryParams, ...rest } = input
  return rest
}

const configuredRoute = <Body, Prepared>(route: Route<Body, Prepared>, input: Config) =>
  route.with({
    auth: auth(input),
    endpoint: { baseURL: input.baseURL, query: input.queryParams },
  })

export const configure = (input: Config = {}) => {
  const responsesRoute = configuredRoute(OpenAIResponses.route, input)
  const responsesWebSocketRoute = configuredRoute(OpenAIResponses.webSocketRoute, input)
  const chatRoute = configuredRoute(OpenAIChat.route, input)
  const modelDefaults = defaults(input)

  const responses = (id: string | ModelID) =>
    responsesRoute.model(withOpenAIOptions(id, modelDefaults, { textVerbosity: true }))
  const responsesWebSocket = (id: string | ModelID) =>
    responsesWebSocketRoute.model(withOpenAIOptions(id, modelDefaults, { textVerbosity: true }))
  const chat = (id: string | ModelID) => chatRoute.model(withOpenAIOptions(id, modelDefaults))

  return {
    id,
    model: responses,
    responses,
    responsesWebSocket,
    chat,
    configure,
  }
}

export const provider = configure()

export const model = provider.model
export const responses = provider.responses
export const responsesWebSocket = provider.responsesWebSocket
export const chat = provider.chat
